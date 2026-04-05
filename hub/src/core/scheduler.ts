import { getDb, DbSchedule } from '../db/index.js';
import { createLogger } from '../system/logger.js';
import { eventBus, EventTypes } from './event-bus.js';
import { v4 as uuidv4 } from 'uuid';

const log = createLogger('scheduler');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleAction {
  state: 'ON' | 'OFF';
  channel?: number;
}

export interface Schedule {
  id: string;
  name: string;
  deviceId: string | null;
  roomId: string | null;
  action: ScheduleAction;
  runAt: number;           // Unix epoch seconds
  repeatCron: string | null;
  enabled: boolean;
  lastRunAt: number | null;
  createdAt: number;
}

export interface CreateScheduleInput {
  name: string;
  deviceId?: string;
  roomId?: string;
  action: ScheduleAction;
  runAt: number;
  repeatCron?: string;
}

// ─── Cron helpers (minimal, no external deps) ────────────────────────────────

/**
 * Evaluate whether a cron expression matches the given Date.
 *
 * Supported field order: minute hour dom month dow
 * Supports: * (wildcard), exact values, comma-lists, ranges (a-b), step /n.
 */
function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minuteF, hourF, domF, monthF, dowF] = fields;

  return (
    matchField(minuteF, date.getMinutes(), 0, 59) &&
    matchField(hourF, date.getHours(), 0, 23) &&
    matchField(domF, date.getDate(), 1, 31) &&
    matchField(monthF, date.getMonth() + 1, 1, 12) &&
    matchField(dowF, date.getDay(), 0, 6)
  );
}

function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;

  for (const part of field.split(',')) {
    if (matchPart(part, value, min, max)) return true;
  }

  return false;
}

function matchPart(part: string, value: number, min: number, max: number): boolean {
  // Step: */n or a-b/n
  if (part.includes('/')) {
    const [rangePart, stepStr] = part.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    let rangeMin = min;
    let rangeMax = max;

    if (rangePart !== '*') {
      const bounds = parseRange(rangePart);
      if (!bounds) return false;
      [rangeMin, rangeMax] = bounds;
    }

    for (let v = rangeMin; v <= rangeMax; v += step) {
      if (v === value) return true;
    }
    return false;
  }

  // Range: a-b
  if (part.includes('-')) {
    const bounds = parseRange(part);
    if (!bounds) return false;
    return value >= bounds[0] && value <= bounds[1];
  }

  // Exact value
  const exact = parseInt(part, 10);
  return !isNaN(exact) && exact === value;
}

function parseRange(s: string): [number, number] | null {
  const [aStr, bStr] = s.split('-');
  const a = parseInt(aStr, 10);
  const b = parseInt(bStr, 10);
  if (isNaN(a) || isNaN(b)) return null;
  return [a, b];
}

/**
 * Given a cron expression and a reference time, compute the next Unix epoch
 * (in seconds) at which the expression will fire (searches up to 1 year ahead).
 */
function nextCronRun(expr: string, afterEpochSec: number): number | null {
  // Advance to next minute boundary
  let candidate = new Date((afterEpochSec + 60) * 1000);
  candidate.setSeconds(0, 0);

  const limit = new Date((afterEpochSec + 366 * 24 * 3600) * 1000);

  while (candidate <= limit) {
    if (cronMatches(expr, candidate)) {
      return Math.floor(candidate.getTime() / 1000);
    }
    candidate = new Date(candidate.getTime() + 60_000); // +1 min
  }

  return null;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

class Scheduler {
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly TICK_INTERVAL_MS = 1_000; // 1-second precision

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.tickTimer) {
      log.warn('Scheduler already running');
      return;
    }

    log.info('Scheduler started (1s precision)');

    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => {
        log.error({ err }, 'Scheduler tick error');
      });
    }, this.TICK_INTERVAL_MS);

    // Don't hold the event loop open
    if (this.tickTimer.unref) {
      this.tickTimer.unref();
    }
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      log.info('Scheduler stopped');
    }
  }

  get isRunning(): boolean {
    return this.tickTimer !== null;
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  /**
   * Called every second.  Finds all enabled schedules whose run_at has passed
   * and fires them, then reschedules any repeating ones.
   */
  private async tick(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const db = getDb();

    const due = db
      .prepare<[number], DbSchedule>(`
        SELECT id, name, device_id, room_id, action, run_at,
               repeat_cron, enabled, last_run_at, created_at
        FROM   schedules
        WHERE  enabled = 1
          AND  run_at <= ?
      `)
      .all(nowSec);

    if (due.length === 0) return;

    log.debug({ count: due.length, nowSec }, 'Due schedules found');

    for (const row of due) {
      await this.fireSchedule(row, nowSec);
    }
  }

  private async fireSchedule(row: DbSchedule, nowSec: number): Promise<void> {
    const db = getDb();

    let action: ScheduleAction;
    try {
      action = JSON.parse(row.action) as ScheduleAction;
    } catch {
      log.error({ scheduleId: row.id, raw: row.action }, 'Invalid action JSON in schedule');
      // Disable broken schedule to avoid repeated errors
      db.prepare('UPDATE schedules SET enabled = 0 WHERE id = ?').run(row.id);
      return;
    }

    log.info(
      { scheduleId: row.id, name: row.name, deviceId: row.device_id, roomId: row.room_id, action },
      'Schedule fired'
    );

    // ── Emit event → consumed by automation engine ──────────────────────────
    eventBus.emit(EventTypes.SCHEDULE_FIRED, {
      scheduleId: row.id,
      deviceId:   row.device_id ?? undefined,
      roomId:     row.room_id   ?? undefined,
      action:     action as unknown as Record<string, unknown>,
      timestamp:  Date.now(),
    });

    // ── Persist last_run_at ─────────────────────────────────────────────────
    if (row.repeat_cron) {
      const nextRun = nextCronRun(row.repeat_cron, nowSec);
      if (nextRun) {
        db.prepare(`
          UPDATE schedules
          SET last_run_at = ?, run_at = ?
          WHERE id = ?
        `).run(nowSec, nextRun, row.id);

        log.debug(
          { scheduleId: row.id, nextRun },
          'Repeating schedule rescheduled'
        );
      } else {
        // No future match found — disable
        db.prepare(`
          UPDATE schedules SET last_run_at = ?, enabled = 0 WHERE id = ?
        `).run(nowSec, row.id);

        log.warn({ scheduleId: row.id }, 'Repeating schedule has no future run — disabled');
      }
    } else {
      // One-shot — mark as run and disable
      db.prepare(`
        UPDATE schedules SET last_run_at = ?, enabled = 0 WHERE id = ?
      `).run(nowSec, row.id);
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  createSchedule(input: CreateScheduleInput): Schedule {
    const db = getDb();
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare<[string, string, string | null, string | null, string, number, string | null, number]>(`
      INSERT INTO schedules
        (id, name, device_id, room_id, action, run_at, repeat_cron, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.deviceId ?? null,
      input.roomId   ?? null,
      JSON.stringify(input.action),
      input.runAt,
      input.repeatCron ?? null,
      now,
    );

    log.info(
      { scheduleId: id, name: input.name, runAt: input.runAt, repeatCron: input.repeatCron },
      'Schedule created'
    );

    return this.getScheduleOrThrow(id);
  }

  getSchedule(scheduleId: string): Schedule | null {
    const db = getDb();
    const row = db
      .prepare<[string], DbSchedule>(`
        SELECT id, name, device_id, room_id, action, run_at,
               repeat_cron, enabled, last_run_at, created_at
        FROM schedules WHERE id = ?
      `)
      .get(scheduleId);

    return row ? this.mapSchedule(row) : null;
  }

  getScheduleOrThrow(scheduleId: string): Schedule {
    const s = this.getSchedule(scheduleId);
    if (!s) throw new Error(`Schedule not found: ${scheduleId}`);
    return s;
  }

  listSchedules(onlyEnabled = false): Schedule[] {
    const db = getDb();
    const sql = onlyEnabled
      ? `SELECT id, name, device_id, room_id, action, run_at,
                repeat_cron, enabled, last_run_at, created_at
         FROM schedules WHERE enabled = 1 ORDER BY run_at ASC`
      : `SELECT id, name, device_id, room_id, action, run_at,
                repeat_cron, enabled, last_run_at, created_at
         FROM schedules ORDER BY run_at ASC`;

    const rows = db.prepare<[], DbSchedule>(sql).all();
    return rows.map((r) => this.mapSchedule(r));
  }

  updateSchedule(
    scheduleId: string,
    input: Partial<CreateScheduleInput> & { enabled?: boolean }
  ): Schedule {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      setClauses.push('name = ?');
      values.push(input.name);
    }
    if (input.deviceId !== undefined) {
      setClauses.push('device_id = ?');
      values.push(input.deviceId);
    }
    if (input.roomId !== undefined) {
      setClauses.push('room_id = ?');
      values.push(input.roomId);
    }
    if (input.action !== undefined) {
      setClauses.push('action = ?');
      values.push(JSON.stringify(input.action));
    }
    if (input.runAt !== undefined) {
      setClauses.push('run_at = ?');
      values.push(input.runAt);
    }
    if (input.repeatCron !== undefined) {
      setClauses.push('repeat_cron = ?');
      values.push(input.repeatCron);
    }
    if (input.enabled !== undefined) {
      setClauses.push('enabled = ?');
      values.push(input.enabled ? 1 : 0);
    }

    if (setClauses.length === 0) return this.getScheduleOrThrow(scheduleId);

    values.push(scheduleId);
    db.prepare(`UPDATE schedules SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    log.info({ scheduleId, changes: input }, 'Schedule updated');

    return this.getScheduleOrThrow(scheduleId);
  }

  deleteSchedule(scheduleId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
    log.info({ scheduleId }, 'Schedule deleted');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private mapSchedule(row: DbSchedule): Schedule {
    let action: ScheduleAction;
    try {
      action = JSON.parse(row.action) as ScheduleAction;
    } catch {
      action = { state: 'OFF' };
    }

    return {
      id:          row.id,
      name:        row.name,
      deviceId:    row.device_id,
      roomId:      row.room_id,
      action,
      runAt:       row.run_at,
      repeatCron:  row.repeat_cron,
      enabled:     row.enabled === 1,
      lastRunAt:   row.last_run_at,
      createdAt:   row.created_at,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const scheduler = new Scheduler();
