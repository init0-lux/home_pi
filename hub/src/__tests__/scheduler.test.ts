import Database from "better-sqlite3";

// ─── Mocks (must be defined before any imports that use them) ─────────────────

jest.mock("../db/index.js", () => ({
  getDb: () => _testDb,
  initDb: () => _testDb,
  closeDb: jest.fn(),
}));

jest.mock("../system/logger.js", () => ({
  createLogger: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  }),
  logger: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

jest.mock("../config/index.js", () => ({
  config: {
    server: {
      nodeEnv: "test",
      port: 3000,
      host: "0.0.0.0",
      isDev: false,
      isProd: false,
    },
    mqtt: {
      host: "localhost",
      port: 1883,
      username: "",
      password: "",
      clientId: "test",
      qos: 1,
      brokerUrl: "mqtt://localhost:1883",
    },
    db: { path: ":memory:" },
    auth: { googleClientId: "", jwtSecret: "test-secret", jwtExpiry: "1d" },
    health: {
      deviceOfflineThresholdSeconds: 30,
      deviceHeartbeatIntervalSeconds: 10,
    },
    ota: { firmwareDir: "/tmp/firmware" },
    logging: { level: "silent" },
    mcp: { enabled: false, apiKey: "" },
    cors: { origins: [] },
    hub: { propertyId: "test-property", name: "Test Hub" },
  },
}));

// Track event emissions
const mockEmit = jest.fn();
const mockOn = jest.fn(() => jest.fn()); // returns an unsubscribe fn

jest.mock("../core/event-bus.js", () => ({
  EventTypes: {
    SCHEDULE_FIRED: "SCHEDULE_FIRED",
    DEVICE_STATE_CHANGED: "DEVICE_STATE_CHANGED",
  },
  eventBus: {
    emit: mockEmit,
    on: mockOn,
    once: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
    listenerCount: jest.fn(() => 0),
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { scheduler } from "../core/scheduler.js";
import { EventTypes } from "../core/event-bus.js";

// ─── Shared test DB ───────────────────────────────────────────────────────────

let _testDb: Database.Database;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id               TEXT PRIMARY KEY,
    room_id          TEXT,
    type             TEXT NOT NULL DEFAULT 'relay',
    name             TEXT,
    ip_address       TEXT,
    firmware_version TEXT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    property_id TEXT NOT NULL DEFAULT 'test-property',
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    device_id   TEXT,
    room_id     TEXT,
    action      TEXT NOT NULL,
    run_at      INTEGER NOT NULL,
    repeat_cron TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`;

function seedDevice(id: string, roomId?: string): void {
  _testDb
    .prepare(
      `
    INSERT OR IGNORE INTO devices (id, room_id) VALUES (?, ?)
  `,
    )
    .run(id, roomId ?? null);
}

function seedRoom(id: string, name = "Test Room"): void {
  _testDb
    .prepare(
      `
    INSERT OR IGNORE INTO rooms (id, name) VALUES (?, ?)
  `,
    )
    .run(id, name);
}

function getScheduleFromDb(id: string) {
  return _testDb.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as
    | {
        id: string;
        name: string;
        device_id: string | null;
        room_id: string | null;
        action: string;
        run_at: number;
        repeat_cron: string | null;
        enabled: number;
        last_run_at: number | null;
        created_at: number;
      }
    | undefined;
}

// A safe future timestamp (1 year from now)
const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 365;
// A past timestamp (1 hour ago)
const PAST = Math.floor(Date.now() / 1000) - 3600;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Scheduler", () => {
  beforeEach(() => {
    _testDb = new Database(":memory:");
    _testDb.pragma("journal_mode = WAL");
    _testDb.exec(SCHEMA);
    jest.clearAllMocks();

    // Ensure scheduler is stopped between tests
    scheduler.stop();
  });

  afterEach(() => {
    scheduler.stop();
    if (_testDb?.open) _testDb.close();
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  describe("start / stop", () => {
    it("should start and report isRunning = true", () => {
      expect(scheduler.isRunning).toBe(false);
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
    });

    it("should stop and report isRunning = false", () => {
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it("should log a warning (not throw) when started twice", () => {
      scheduler.start();
      expect(() => scheduler.start()).not.toThrow();
      expect(scheduler.isRunning).toBe(true);
    });

    it("should be idempotent to call stop() when already stopped", () => {
      expect(scheduler.isRunning).toBe(false);
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.isRunning).toBe(false);
    });
  });

  // ── createSchedule ──────────────────────────────────────────────────────────

  describe("createSchedule()", () => {
    it("should insert a one-shot schedule targeting a device", () => {
      seedDevice("dev-sched-1");

      const s = scheduler.createSchedule({
        name: "Turn off at night",
        deviceId: "dev-sched-1",
        action: { state: "OFF", channel: 0 },
        runAt: FUTURE,
      });

      expect(s.id).toBeTruthy();
      expect(s.name).toBe("Turn off at night");
      expect(s.deviceId).toBe("dev-sched-1");
      expect(s.roomId).toBeNull();
      expect(s.action).toMatchObject({ state: "OFF", channel: 0 });
      expect(s.runAt).toBe(FUTURE);
      expect(s.repeatCron).toBeNull();
      expect(s.enabled).toBe(true);
      expect(s.lastRunAt).toBeNull();
    });

    it("should insert a one-shot schedule targeting a room", () => {
      seedRoom("room-sched-1");

      const s = scheduler.createSchedule({
        name: "Morning lights",
        roomId: "room-sched-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      expect(s.roomId).toBe("room-sched-1");
      expect(s.deviceId).toBeNull();
    });

    it("should insert a repeating schedule with a cron expression", () => {
      seedRoom("room-cron-1");

      const s = scheduler.createSchedule({
        name: "Daily 7am ON",
        roomId: "room-cron-1",
        action: { state: "ON" },
        runAt: FUTURE,
        repeatCron: "0 7 * * *",
      });

      expect(s.repeatCron).toBe("0 7 * * *");
    });

    it("should persist the schedule to the database", () => {
      seedDevice("dev-persist");

      const s = scheduler.createSchedule({
        name: "DB persist test",
        deviceId: "dev-persist",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const row = getScheduleFromDb(s.id);
      expect(row).toBeDefined();
      expect(row!.name).toBe("DB persist test");
      expect(row!.action).toBe(JSON.stringify({ state: "ON" }));
      expect(row!.enabled).toBe(1);
    });

    it("should generate unique IDs for different schedules", () => {
      seedDevice("dev-uniq-1");
      seedDevice("dev-uniq-2");

      const s1 = scheduler.createSchedule({
        name: "Schedule A",
        deviceId: "dev-uniq-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const s2 = scheduler.createSchedule({
        name: "Schedule B",
        deviceId: "dev-uniq-2",
        action: { state: "OFF" },
        runAt: FUTURE + 60,
      });

      expect(s1.id).not.toBe(s2.id);
    });

    it("should store the action as parseable JSON", () => {
      seedDevice("dev-json-action");

      const s = scheduler.createSchedule({
        name: "JSON action test",
        deviceId: "dev-json-action",
        action: { state: "ON", channel: 2 },
        runAt: FUTURE,
      });

      expect(s.action.state).toBe("ON");
      expect(s.action.channel).toBe(2);
    });
  });

  // ── getSchedule ─────────────────────────────────────────────────────────────

  describe("getSchedule()", () => {
    it("should return null for a non-existent schedule ID", () => {
      const result = scheduler.getSchedule("does-not-exist");
      expect(result).toBeNull();
    });

    it("should return the correct schedule by ID", () => {
      seedDevice("dev-get-1");

      const created = scheduler.createSchedule({
        name: "Get by ID test",
        deviceId: "dev-get-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const fetched = scheduler.getSchedule(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe("Get by ID test");
    });

    it("should correctly map boolean enabled field", () => {
      seedDevice("dev-enabled-check");

      const s = scheduler.createSchedule({
        name: "Enabled check",
        deviceId: "dev-enabled-check",
        action: { state: "OFF" },
        runAt: FUTURE,
      });

      const fetched = scheduler.getSchedule(s.id);
      expect(fetched!.enabled).toBe(true); // DB stores 1 → mapped to true
    });
  });

  // ── getScheduleOrThrow ───────────────────────────────────────────────────────

  describe("getScheduleOrThrow()", () => {
    it("should throw an error for a missing schedule", () => {
      expect(() => scheduler.getScheduleOrThrow("missing-id")).toThrow(
        "Schedule not found: missing-id",
      );
    });

    it("should return the schedule when it exists", () => {
      seedDevice("dev-throw-1");

      const s = scheduler.createSchedule({
        name: "Throw test",
        deviceId: "dev-throw-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      expect(() => scheduler.getScheduleOrThrow(s.id)).not.toThrow();
    });
  });

  // ── listSchedules ────────────────────────────────────────────────────────────

  describe("listSchedules()", () => {
    it("should return an empty array when no schedules exist", () => {
      const result = scheduler.listSchedules();
      expect(result).toEqual([]);
    });

    it("should return all schedules when onlyEnabled is false", () => {
      seedDevice("dev-list-1");
      seedDevice("dev-list-2");

      scheduler.createSchedule({
        name: "Schedule list 1",
        deviceId: "dev-list-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const s2 = scheduler.createSchedule({
        name: "Schedule list 2",
        deviceId: "dev-list-2",
        action: { state: "OFF" },
        runAt: FUTURE + 3600,
      });

      // Disable s2
      scheduler.updateSchedule(s2.id, { enabled: false });

      const all = scheduler.listSchedules(false);
      expect(all.length).toBe(2);
    });

    it("should return only enabled schedules when onlyEnabled is true", () => {
      seedDevice("dev-filter-1");
      seedDevice("dev-filter-2");
      seedDevice("dev-filter-3");

      const sA = scheduler.createSchedule({
        name: "Enabled A",
        deviceId: "dev-filter-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const s2 = scheduler.createSchedule({
        name: "Enabled B",
        deviceId: "dev-filter-2",
        action: { state: "ON" },
        runAt: FUTURE + 60,
      });

      const s3 = scheduler.createSchedule({
        name: "Disabled C",
        deviceId: "dev-filter-3",
        action: { state: "OFF" },
        runAt: FUTURE + 120,
      });

      scheduler.updateSchedule(s3.id, { enabled: false });

      const enabled = scheduler.listSchedules(true);
      expect(enabled.length).toBe(2);
      expect(enabled.map((s) => s.id)).toContain(sA.id);
      expect(enabled.map((s) => s.id)).toContain(s2.id);
      expect(enabled.map((s) => s.id)).not.toContain(s3.id);
    });

    it("should return schedules ordered by run_at ascending", () => {
      seedDevice("dev-order-1");

      scheduler.createSchedule({
        name: "Third",
        deviceId: "dev-order-1",
        action: { state: "ON" },
        runAt: FUTURE + 7200,
      });

      scheduler.createSchedule({
        name: "First",
        deviceId: "dev-order-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      scheduler.createSchedule({
        name: "Second",
        deviceId: "dev-order-1",
        action: { state: "ON" },
        runAt: FUTURE + 3600,
      });

      const all = scheduler.listSchedules();
      expect(all[0].name).toBe("First");
      expect(all[1].name).toBe("Second");
      expect(all[2].name).toBe("Third");
    });
  });

  // ── updateSchedule ───────────────────────────────────────────────────────────

  describe("updateSchedule()", () => {
    it("should update the name of a schedule", () => {
      seedDevice("dev-update-1");

      const s = scheduler.createSchedule({
        name: "Original Name",
        deviceId: "dev-update-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const updated = scheduler.updateSchedule(s.id, { name: "Updated Name" });
      expect(updated.name).toBe("Updated Name");

      const fromDb = getScheduleFromDb(s.id);
      expect(fromDb!.name).toBe("Updated Name");
    });

    it("should disable a schedule", () => {
      seedDevice("dev-disable-1");

      const s = scheduler.createSchedule({
        name: "Disable me",
        deviceId: "dev-disable-1",
        action: { state: "OFF" },
        runAt: FUTURE,
      });

      expect(s.enabled).toBe(true);

      const updated = scheduler.updateSchedule(s.id, { enabled: false });
      expect(updated.enabled).toBe(false);

      const fromDb = getScheduleFromDb(s.id);
      expect(fromDb!.enabled).toBe(0);
    });

    it("should re-enable a disabled schedule", () => {
      seedDevice("dev-reenable-1");

      const s = scheduler.createSchedule({
        name: "Re-enable me",
        deviceId: "dev-reenable-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      scheduler.updateSchedule(s.id, { enabled: false });
      const reEnabled = scheduler.updateSchedule(s.id, { enabled: true });

      expect(reEnabled.enabled).toBe(true);
    });

    it("should update the runAt timestamp", () => {
      seedDevice("dev-rescheduled-1");

      const s = scheduler.createSchedule({
        name: "Reschedule me",
        deviceId: "dev-rescheduled-1",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const newRunAt = FUTURE + 86400;
      const updated = scheduler.updateSchedule(s.id, { runAt: newRunAt });
      expect(updated.runAt).toBe(newRunAt);
    });

    it("should update the action", () => {
      seedDevice("dev-action-update-1");

      const s = scheduler.createSchedule({
        name: "Change action",
        deviceId: "dev-action-update-1",
        action: { state: "ON", channel: 0 },
        runAt: FUTURE,
      });

      const updated = scheduler.updateSchedule(s.id, {
        action: { state: "OFF", channel: 1 },
      });

      expect(updated.action.state).toBe("OFF");
      expect(updated.action.channel).toBe(1);
    });

    it("should update the repeatCron expression", () => {
      seedDevice("dev-cron-update-1");

      const s = scheduler.createSchedule({
        name: "Cron update",
        deviceId: "dev-cron-update-1",
        action: { state: "ON" },
        runAt: FUTURE,
        repeatCron: "0 7 * * *",
      });

      const updated = scheduler.updateSchedule(s.id, {
        repeatCron: "0 22 * * *",
      });
      expect(updated.repeatCron).toBe("0 22 * * *");
    });

    it("should return the unchanged schedule when no updates are provided", () => {
      seedDevice("dev-noop-update");

      const s = scheduler.createSchedule({
        name: "No-op update",
        deviceId: "dev-noop-update",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      const result = scheduler.updateSchedule(s.id, {});
      expect(result.id).toBe(s.id);
      expect(result.name).toBe("No-op update");
    });
  });

  // ── deleteSchedule ───────────────────────────────────────────────────────────

  describe("deleteSchedule()", () => {
    it("should remove the schedule from the database", () => {
      seedDevice("dev-delete-1");

      const s = scheduler.createSchedule({
        name: "Delete me",
        deviceId: "dev-delete-1",
        action: { state: "OFF" },
        runAt: FUTURE,
      });

      expect(getScheduleFromDb(s.id)).toBeDefined();

      scheduler.deleteSchedule(s.id);

      expect(getScheduleFromDb(s.id)).toBeUndefined();
    });

    it("should cause getSchedule() to return null after deletion", () => {
      seedDevice("dev-delete-2");

      const s = scheduler.createSchedule({
        name: "Delete check",
        deviceId: "dev-delete-2",
        action: { state: "ON" },
        runAt: FUTURE,
      });

      scheduler.deleteSchedule(s.id);

      expect(scheduler.getSchedule(s.id)).toBeNull();
    });

    it("should not throw when deleting a non-existent schedule", () => {
      expect(() => scheduler.deleteSchedule("ghost-schedule-id")).not.toThrow();
    });
  });

  // ── Scheduler tick / event emission ─────────────────────────────────────────
  //
  // We can't easily test real timer ticks without fake timers, but we CAN
  // test the internal firing logic by directly inserting past-due schedules
  // and manually advancing a tick via jest.useFakeTimers().

  describe("tick / schedule firing", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      scheduler.stop();
    });

    it("should emit SCHEDULE_FIRED for a past-due one-shot schedule", async () => {
      seedDevice("dev-tick-1");

      // Insert a schedule that is already past-due
      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
        VALUES ('past-due-1', 'Past due', 'dev-tick-1', '{"state":"ON"}', ?, 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();

      // Advance the fake clock by 1s to trigger a tick
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockEmit).toHaveBeenCalledWith(
        EventTypes.SCHEDULE_FIRED,
        expect.objectContaining({
          scheduleId: "past-due-1",
          deviceId: "dev-tick-1",
          action: expect.objectContaining({ state: "ON" }),
        }),
      );
    });

    it("should disable a one-shot schedule after it fires", async () => {
      seedDevice("dev-oneshot-1");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
        VALUES ('oneshot-1', 'One shot', 'dev-oneshot-1', '{"state":"OFF"}', ?, 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const row = getScheduleFromDb("oneshot-1");
      expect(row!.enabled).toBe(0);
      expect(row!.last_run_at).not.toBeNull();
    });

    it("should NOT emit SCHEDULE_FIRED for a disabled schedule", async () => {
      seedDevice("dev-disabled-tick");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
        VALUES ('disabled-sched', 'Disabled', 'dev-disabled-tick', '{"state":"ON"}', ?, 0, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const scheduleFireCalls = mockEmit.mock.calls.filter(
        ([type]: [string]) => type === EventTypes.SCHEDULE_FIRED,
      );
      expect(scheduleFireCalls).toHaveLength(0);
    });

    it("should NOT emit SCHEDULE_FIRED for a future schedule", async () => {
      seedDevice("dev-future-tick");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
        VALUES ('future-sched', 'Future', 'dev-future-tick', '{"state":"ON"}', ?, 1, strftime('%s','now'))
      `,
        )
        .run(FUTURE);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const scheduleFireCalls = mockEmit.mock.calls.filter(
        ([type]: [string]) => type === EventTypes.SCHEDULE_FIRED,
      );
      expect(scheduleFireCalls).toHaveLength(0);
    });

    it("should fire multiple past-due schedules in a single tick", async () => {
      seedDevice("dev-multi-tick");

      for (let i = 1; i <= 3; i++) {
        _testDb
          .prepare(
            `
          INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
          VALUES (?, ?, 'dev-multi-tick', '{"state":"ON"}', ?, 1, strftime('%s','now'))
        `,
          )
          .run(`multi-${i}`, `Multi ${i}`, PAST - i);
      }

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const scheduleFireCalls = mockEmit.mock.calls.filter(
        ([type]: [string]) => type === EventTypes.SCHEDULE_FIRED,
      );
      expect(scheduleFireCalls).toHaveLength(3);
    });

    it("should reschedule a repeating schedule after it fires", async () => {
      seedDevice("dev-repeat-1");

      // A repeating schedule: every minute (* * * * *)
      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, repeat_cron, enabled, created_at)
        VALUES ('repeat-1', 'Repeating', 'dev-repeat-1', '{"state":"ON"}', ?, '* * * * *', 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const row = getScheduleFromDb("repeat-1");

      // Should still be enabled (rescheduled)
      expect(row!.enabled).toBe(1);
      // next run_at should be in the future
      expect(row!.run_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
      // last_run_at should be set
      expect(row!.last_run_at).not.toBeNull();
    });

    it("should disable a repeating schedule with a malformed action JSON", async () => {
      seedDevice("dev-bad-action");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
        VALUES ('bad-action-1', 'Bad action', 'dev-bad-action', 'NOT_VALID_JSON', ?, 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const row = getScheduleFromDb("bad-action-1");
      // Should be disabled to prevent repeated errors
      expect(row!.enabled).toBe(0);
    });
  });

  // ── Cron expression validation ───────────────────────────────────────────────
  //
  // We test cron matching indirectly by creating repeating schedules and
  // verifying that after firing, run_at is set to a sensible future value.
  // Direct cron tests use the scheduler's createSchedule → fire → verify pattern.

  describe("cron expression support", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      scheduler.stop();
    });

    const commonCronCases: Array<{ expr: string; description: string }> = [
      { expr: "0 7 * * *", description: "every day at 7am" },
      { expr: "0 22 * * *", description: "every day at 10pm" },
      { expr: "0 */6 * * *", description: "every 6 hours" },
      { expr: "30 8 * * 1", description: "Monday 8:30am" },
      { expr: "0 0 1 * *", description: "first of the month at midnight" },
      { expr: "* * * * *", description: "every minute" },
      { expr: "0 9-17 * * 1-5", description: "every hour 9am-5pm weekdays" },
    ];

    it.each(commonCronCases)(
      'should accept cron expression "$expr" ($description)',
      async ({ expr }) => {
        seedDevice("dev-cron-valid");

        const s = scheduler.createSchedule({
          name: `Cron: ${expr}`,
          deviceId: "dev-cron-valid",
          action: { state: "ON" },
          runAt: PAST,
          repeatCron: expr,
        });

        scheduler.start();
        await jest.advanceTimersByTimeAsync(1000);

        const row = getScheduleFromDb(s.id);
        // If the cron expression was valid, the schedule should have been rescheduled
        // (enabled = 1 and run_at > PAST)
        expect(row!.enabled).toBe(1);
        expect(row!.run_at).toBeGreaterThan(PAST);

        // Cleanup for next iteration
        scheduler.stop();
        scheduler.deleteSchedule(s.id);
        jest.clearAllMocks();
      },
    );

    it('should reschedule "every minute" cron to within the next 2 minutes', async () => {
      seedDevice("dev-every-minute");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, repeat_cron, enabled, created_at)
        VALUES ('every-min', 'Every minute', 'dev-every-minute', '{"state":"ON"}', ?, '* * * * *', 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      const nowSec = Math.floor(Date.now() / 1000);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const row = getScheduleFromDb("every-min");

      expect(row!.run_at).toBeGreaterThan(nowSec);
      // Should be within the next 2 minutes (120 seconds)
      expect(row!.run_at).toBeLessThanOrEqual(nowSec + 120);
    });
  });

  // ── Action mapping ───────────────────────────────────────────────────────────

  describe("schedule action payload", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      scheduler.stop();
    });

    it("should include the correct action in the SCHEDULE_FIRED event", async () => {
      seedDevice("dev-action-verify");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, device_id, action, run_at, enabled, created_at)
        VALUES ('action-verify', 'Action verify', 'dev-action-verify', '{"state":"OFF","channel":2}', ?, 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const fireCall = mockEmit.mock.calls.find(
        ([type]: [string]) => type === EventTypes.SCHEDULE_FIRED,
      );

      expect(fireCall).toBeDefined();
      expect(fireCall![1]).toMatchObject({
        scheduleId: "action-verify",
        deviceId: "dev-action-verify",
        action: { state: "OFF", channel: 2 },
      });
    });

    it("should include roomId in the SCHEDULE_FIRED event for room-level schedules", async () => {
      seedRoom("room-fired-1");

      _testDb
        .prepare(
          `
        INSERT INTO schedules (id, name, room_id, action, run_at, enabled, created_at)
        VALUES ('room-fired', 'Room fired', 'room-fired-1', '{"state":"ON"}', ?, 1, strftime('%s','now'))
      `,
        )
        .run(PAST);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(1000);

      const fireCall = mockEmit.mock.calls.find(
        ([type]: [string]) => type === EventTypes.SCHEDULE_FIRED,
      );

      expect(fireCall).toBeDefined();
      expect(fireCall![1]).toMatchObject({
        scheduleId: "room-fired",
        roomId: "room-fired-1",
        action: { state: "ON" },
      });
    });
  });
});
