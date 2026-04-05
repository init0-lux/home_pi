import { getDb, DbSchedule } from "../db/index.js";
import { createLogger } from "../system/logger.js";
import { eventBus, EventTypes } from "./event-bus.js";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("scheduler");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleAction {
  state: "ON" | "OFF";
  channel?: number;
}

export interface Schedule {
  id: string;
  name: string;
  deviceId: string | null;
  roomId: string | null;
  action: ScheduleAction;
  runAt: number; // Unix epoch seconds
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

// ─── Minimal Cron Parser ──────────────────────────────────────────────────────
//
// Supports the standard 5-field cron format:  minute hour dom month dow
// Field syntax: * (any), exact value, a-b (range), a/n (step), comma lists.
// No external dependency — keeps the image small and startup fast.

function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minF, hourF, domF, monF, dowF] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  return (
    matchField(minF,  date.getMinutes(),     0, 59) &&
    matchField(hourF, date.getHours(),       0, 23) &&
    matchField(domF,  date.getDate(),        1, 31) &&
    matchField(monF,  date.getMonth() + 1,   1, 12) &&
    matchField(dowF,  date.getDay(),         0,  6)
  );
}

function matchField(field: string, value: number, _min: number, _max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (matchPart(part, value, _min, _max)) return true;
  }
  return false;
}

function matchPart(part: string, value: number, min: number, max: number): boolean {
  // Step: */n  or  a-b/n
  if (part.includes("/")) {
    const [rangePart, stepStr] = part.split("/") as [string, string];
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    let lo = min;
    let hi = max;

    if (rangePart !== "*") {
      const bounds = parseRange(rangePart);
      if (!bounds) return false;
      [lo, hi] = bounds;
    }

    for (let v = lo; v <= hi; v += step) {
      if (v === value) return true;
    }
    return false;
  }

  // Range: a-b
  if (part.includes("-")) {
    const bounds = parseRange(part);
    if (!bounds) return false;
    return value >= bounds[0] && value <= bounds[1];
  }

  // Exact value
  const exact = parseInt(part, 10);
  return !isNaN(exact) && exact === value;
}

function parseRange(s: string): [number, number] | null {
  const [aStr, bStr] = s.split("-") as [string, string | undefined];
  const a = parseInt(aStr, 10);
  const b = parseInt(bStr ?? "", 10);
  if (isNaN(a) || isNaN(b)) return null;
  return [a, b];
}

/**
 * Given a cron expression and a reference epoch (seconds), return the
 * next epoch (seconds) at which the expression fires. Searches up to 1 year
 * ahead in 1-minute increments. Returns null if no match is found.
 */
function nextCronRun(expr: string, afterEpochSec: number): number | null {
  // Advance to the next whole minute
  let candidate = new Date((afterEpochSec + 60) * 1000);
  candidate.setSeconds(0, 0);

  const limit = new Date((afterEpochSec + 366 * 24 * 3600) * 1000);

  while (candidate <= limit) {
    if (cronMatches(expr, candidate)) {
      return Math.floor(candidate.getTime() / 1000);
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return null;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

class Scheduler {
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly TICK_INTERVAL_MS = 1_000; // 1-second precision

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  start(): void {
    if (this.tickTimer) {
      log.warn("Scheduler already running");
      return;
    }

    log.info("Scheduler started (1 s precision)");

    this.tickTimer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        log.error({ err }, "Scheduler tick error");
      });
    }, this.TICK_INTERVAL_MS);

    this.tickTimer.unref?.();
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      log.info("Scheduler stopped");
    }
  }

  get isRunning(): boolean {
    return this.tickTimer !== null;
  }

  // ── Tick ─────────────────────────────────────────────────────────────────────

  /**
   * Called every second. Finds all enabled schedules whose run_at has passed,
   * fires them, then reschedules repeating ones or disables one-shots.
   */
  private async tick(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const db = getDb();

    const due = db
      .prepare<[number], DbSchedule>(`
        SELECT id, name, device_id, room_id, action, run_at,
               repeat_cron, enabled, last_run_at, created_at
        FROM   schedules
        WHERE  enabled = 1 AND run_at <= ?
      `)
      .all(nowSec);

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
      log.error(
        { scheduleId: row.id, raw: row.action },
        "Invalid action JSON — disabling schedule",
      );
      db.prepare("UPDATE schedules SET enabled = 0 WHERE id = ?").run(row.id);
      return;
    }

    log.info(
      { scheduleId: row.id, name: row.name, deviceId: row.device_id, roomId: row.room_id, action },
      "Schedule fired",
    );

    eventBus.emit(EventTypes.SCHEDULE_FIRED, {
      scheduleId: row.id,
      deviceId:   row.device_id ?? undefined,
      roomId:     row.room_id   ?? undefined,
      action:     action as unknown as Record<string, unknown>,
      timestamp:  Date.now(),
    });

    if (row.repeat_cron) {
      const nextRun = nextCronRun(row.repeat_cron, nowSec);

      if (nextRun) {
        db.prepare(
          "UPDATE schedules SET last_run_at = ?, run_at = ? WHERE id = ?",
        ).run(nowSec, nextRun, row.id);

        log.debug({ scheduleId: row.id, nextRun }, "Repeating schedule rescheduled");
      } else {
        db.prepare(
          "UPDATE schedules SET last_run_at = ?, enabled = 0 WHERE id = ?",
        ).run(nowSec, row.id);

        log.warn({ scheduleId: row.id }, "Repeating schedule has no future run — disabled");
      }
    } else {
      // One-shot: mark as run and disable
      db.prepare(
        "UPDATE schedules SET last_run_at = ?, enabled = 0 WHERE id = ?",
      ).run(nowSec, row.id);
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

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
      input.deviceId   ?? null,
      input.roomId     ?? null,
      JSON.stringify(input.action),
      input.runAt,
      input.repeatCron ?? null,
      now,
    );

    log.info(
      { scheduleId: id, name: input.name, runAt: input.runAt, repeatCron: input.repeatCron },
      "Schedule created",
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

    return row ? mapSchedule(row) : null;
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

    return db.prepare<[], DbSchedule>(sql).all().map(mapSchedule);
  }

  updateSchedule(
    scheduleId: string,
    input: Partial<CreateScheduleInput> & { enabled?: boolean },
  ): Schedule {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      setClauses.push("name = ?");
      values.push(input.name);
    }
    if (input.deviceId !== undefined) {
      setClauses.push("device_id = ?");
      values.push(input.deviceId);
    }
    if (input.roomId !== undefined) {
      setClauses.push("room_id = ?");
      values.push(input.roomId);
    }
    if (input.action !== undefined) {
      setClauses.push("action = ?");
      values.push(JSON.stringify(input.action));
    }
    if (input.runAt !== undefined) {
      setClauses.push("run_at = ?");
      values.push(input.runAt);
    }
    if (input.repeatCron !== undefined) {
      setClauses.push("repeat_cron = ?");
      values.push(input.repeatCron);
    }
    if (input.enabled !== undefined) {
      setClauses.push("enabled = ?");
      values.push(input.enabled ? 1 : 0);
    }

    if (setClauses.length === 0) return this.getScheduleOrThrow(scheduleId);

    values.push(scheduleId);
    db.prepare(
      `UPDATE schedules SET ${setClauses.join(", ")} WHERE id = ?`,
    ).run(...values);

    log.info({ scheduleId, changes: input }, "Schedule updated");

    return this.getScheduleOrThrow(scheduleId);
  }

  deleteSchedule(scheduleId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM schedules WHERE id = ?").run(scheduleId);
    log.info({ scheduleId }, "Schedule deleted");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapSchedule(row: DbSchedule): Schedule {
  let action: ScheduleAction;
  try {
    action = JSON.parse(row.action) as ScheduleAction;
  } catch {
    action = { state: "OFF" };
  }

  return {
    id:         row.id,
    name:       row.name,
    deviceId:   row.device_id,
    roomId:     row.room_id,
    action,
    runAt:      row.run_at,
    repeatCron: row.repeat_cron,
    enabled:    row.enabled === 1,
    lastRunAt:  row.last_run_at,
    createdAt:  row.created_at,
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const scheduler = new Scheduler();
