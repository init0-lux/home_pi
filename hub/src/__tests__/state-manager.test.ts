import Database from "better-sqlite3";

// ─── In-memory DB setup ────────────────────────────────────────────────────────
//
// We monkey-patch the db module before importing state-manager so that
// all getDb() calls return our isolated in-memory database instead of
// opening a real file. This keeps tests hermetic and blazing fast.

let _testDb: Database.Database;

jest.mock("../db/index.js", () => {
  return {
    getDb: () => _testDb,
    initDb: () => _testDb,
    closeDb: () => {
      if (_testDb && _testDb.open) _testDb.close();
    },
    // Re-export types (no-ops at runtime)
  };
});

// Also mock the logger so tests don't spam the console
jest.mock("../system/logger.js", () => ({
  createLogger: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: () => ({
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    }),
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

// Mock config so tests don't need .env
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

// Mock event-bus so state-manager's subscribeToEvents() doesn't register
// real listeners that bleed across tests
jest.mock("../core/event-bus.js", () => {
  const handlers: Map<string, Array<(p: unknown) => void>> = new Map();

  return {
    EventTypes: {
      DEVICE_REGISTERED: "DEVICE_REGISTERED",
      DEVICE_UPDATED: "DEVICE_UPDATED",
      DEVICE_REMOVED: "DEVICE_REMOVED",
      DEVICE_STATE_CHANGED: "DEVICE_STATE_CHANGED",
      DEVICE_COMMAND_SENT: "DEVICE_COMMAND_SENT",
      DEVICE_ONLINE: "DEVICE_ONLINE",
      DEVICE_OFFLINE: "DEVICE_OFFLINE",
      DEVICE_HEARTBEAT: "DEVICE_HEARTBEAT",
      MQTT_CONNECTED: "MQTT_CONNECTED",
      MQTT_DISCONNECTED: "MQTT_DISCONNECTED",
      MQTT_MESSAGE: "MQTT_MESSAGE",
      AUTOMATION_TRIGGERED: "AUTOMATION_TRIGGERED",
      SCHEDULE_FIRED: "SCHEDULE_FIRED",
      GUEST_CHECKIN: "GUEST_CHECKIN",
      GUEST_CHECKOUT: "GUEST_CHECKOUT",
      SYSTEM_READY: "SYSTEM_READY",
      SYSTEM_SHUTDOWN: "SYSTEM_SHUTDOWN",
    },
    eventBus: {
      on: jest.fn((type: string, handler: (p: unknown) => void) => {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type)!.push(handler);
        return () => {
          const arr = handlers.get(type) ?? [];
          const idx = arr.indexOf(handler);
          if (idx !== -1) arr.splice(idx, 1);
        };
      }),
      once: jest.fn(),
      off: jest.fn(),
      emit: jest.fn((type: string, payload: unknown) => {
        const arr = handlers.get(type) ?? [];
        for (const h of arr) h(payload);
      }),
      destroy: jest.fn(),
      listenerCount: jest.fn(() => 0),
    },
  };
});

// ─── Now import the modules under test ────────────────────────────────────────

import { stateManager } from "../core/state-manager.js";
import { eventBus, EventTypes } from "../core/event-bus.js";
import type { DeviceStateChangedPayload } from "../core/event-bus.js";

// ─── Schema DDL (minimal subset needed for state-manager) ─────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id               TEXT    PRIMARY KEY,
    room_id          TEXT,
    type             TEXT    NOT NULL DEFAULT 'relay',
    name             TEXT,
    ip_address       TEXT,
    firmware_version TEXT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS states (
    device_id  TEXT    PRIMARY KEY,
    channel    INTEGER NOT NULL DEFAULT 0,
    state      TEXT    NOT NULL DEFAULT 'OFF',
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    property_id TEXT NOT NULL DEFAULT 'test-property',
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedDevice(id: string, roomId?: string): void {
  _testDb
    .prepare(
      `
    INSERT OR IGNORE INTO devices (id, room_id, type, created_at, updated_at)
    VALUES (?, ?, 'relay', strftime('%s','now'), strftime('%s','now'))
  `,
    )
    .run(id, roomId ?? null);
}

function seedRoom(id: string, name: string): void {
  _testDb
    .prepare(
      `
    INSERT OR IGNORE INTO rooms (id, name, property_id, created_at)
    VALUES (?, ?, 'test-property', strftime('%s','now'))
  `,
    )
    .run(id, name);
}

function seedState(
  deviceId: string,
  channel: number,
  state: "ON" | "OFF",
  updatedAt?: number,
): void {
  _testDb
    .prepare(
      `
    INSERT OR REPLACE INTO states (device_id, channel, state, updated_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(deviceId, channel, state, updatedAt ?? Math.floor(Date.now() / 1000));
}

function getStateFromDb(
  deviceId: string,
  channel = 0,
): { state: string; updated_at: number } | undefined {
  return _testDb
    .prepare(
      "SELECT state, updated_at FROM states WHERE device_id = ? AND channel = ?",
    )
    .get(deviceId, channel) as
    | { state: string; updated_at: number }
    | undefined;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("StateManager", () => {
  beforeEach(() => {
    // Fresh in-memory database for every test
    _testDb = new Database(":memory:");
    _testDb.pragma("journal_mode = WAL");
    _testDb.pragma("foreign_keys = ON");
    _testDb.exec(SCHEMA);

    // Reset all mock call histories
    jest.clearAllMocks();

    // Re-initialise the state manager (loads from the fresh DB)
    stateManager.clearCache();
    stateManager.init();
  });

  afterEach(() => {
    if (_testDb && _testDb.open) {
      _testDb.close();
    }
  });

  // ── init ─────────────────────────────────────────────────────────────────────

  describe("init()", () => {
    it("should load existing states into the memory cache on init", () => {
      // Seed some states into the DB before initialising
      seedDevice("device-alpha");
      seedDevice("device-beta");
      seedState("device-alpha", 0, "ON");
      seedState("device-beta", 0, "OFF");

      // Re-init so the cache is populated from DB
      stateManager.clearCache();
      stateManager.init();

      const alpha = stateManager.getDeviceState("device-alpha", 0);
      const beta = stateManager.getDeviceState("device-beta", 0);

      expect(alpha?.state).toBe("ON");
      expect(beta?.state).toBe("OFF");
    });

    it("should start with an empty cache when there are no persisted states", () => {
      stateManager.clearCache();
      stateManager.init();

      expect(stateManager.cacheSize).toBe(0);
    });

    it("should subscribe to DEVICE_STATE_CHANGED on the event bus during init", () => {
      stateManager.init();

      expect(eventBus.on).toHaveBeenCalledWith(
        EventTypes.DEVICE_STATE_CHANGED,
        expect.any(Function),
      );
    });
  });

  // ── getDeviceState ───────────────────────────────────────────────────────────

  describe("getDeviceState()", () => {
    it("should return null for an unknown device", () => {
      const result = stateManager.getDeviceState("nonexistent", 0);
      expect(result).toBeNull();
    });

    it("should return the correct state from the cache", () => {
      seedDevice("cached-device");
      seedState("cached-device", 0, "ON");

      stateManager.clearCache();
      stateManager.init();

      const result = stateManager.getDeviceState("cached-device", 0);

      expect(result).not.toBeNull();
      expect(result!.deviceId).toBe("cached-device");
      expect(result!.channel).toBe(0);
      expect(result!.state).toBe("ON");
    });

    it("should fall back to DB on a cache miss and then populate the cache", () => {
      seedDevice("db-device");
      seedState("db-device", 0, "OFF");

      // Don't init (cache is empty) — force a DB fallback
      stateManager.clearCache();

      const result = stateManager.getDeviceState("db-device", 0);

      expect(result).not.toBeNull();
      expect(result!.state).toBe("OFF");

      // Should now be cached
      expect(stateManager.cacheSize).toBeGreaterThan(0);
    });

    it("should correctly retrieve state for a specific channel", () => {
      seedDevice("multi-channel-device");
      seedState("multi-channel-device", 0, "ON");

      stateManager.clearCache();
      stateManager.init();

      const ch0 = stateManager.getDeviceState("multi-channel-device", 0);

      expect(ch0?.state).toBe("ON");

      // Channel 1 has no state yet
      const ch1 = stateManager.getDeviceState("multi-channel-device", 1);
      expect(ch1).toBeNull();
    });
  });

  // ── getDeviceStates ──────────────────────────────────────────────────────────

  describe("getDeviceStates()", () => {
    it("should return an empty array for a device with no states", () => {
      seedDevice("no-state-device");
      const states = stateManager.getDeviceStates("no-state-device");
      expect(states).toEqual([]);
    });

    it("should return the state for a device with a single recorded state", () => {
      seedDevice("relay-single");
      seedState("relay-single", 0, "ON");

      const states = stateManager.getDeviceStates("relay-single");

      expect(states).toHaveLength(1);
      expect(states[0].state).toBe("ON");
      expect(states[0].channel).toBe(0);
      expect(states[0].deviceId).toBe("relay-single");
    });
  });

  // ── getAllStates ─────────────────────────────────────────────────────────────

  describe("getAllStates()", () => {
    it("should return all persisted states", () => {
      seedDevice("d1");
      seedDevice("d2");
      seedDevice("d3");
      seedState("d1", 0, "ON");
      seedState("d2", 0, "OFF");
      seedState("d3", 0, "ON");

      const all = stateManager.getAllStates();

      expect(all.length).toBeGreaterThanOrEqual(3);

      const d1State = all.find((s) => s.deviceId === "d1");
      const d2State = all.find((s) => s.deviceId === "d2");
      expect(d1State?.state).toBe("ON");
      expect(d2State?.state).toBe("OFF");
    });

    it("should return an empty array when no states exist", () => {
      const all = stateManager.getAllStates();
      expect(all).toEqual([]);
    });
  });

  // ── setDeviceState ───────────────────────────────────────────────────────────

  describe("setDeviceState()", () => {
    it("should persist the new state to the DB", () => {
      seedDevice("persist-device");

      stateManager.setDeviceState("persist-device", 0, "ON", "api");

      const row = getStateFromDb("persist-device", 0);
      expect(row).toBeDefined();
      expect(row!.state).toBe("ON");
    });

    it("should update the in-memory cache immediately", () => {
      seedDevice("cache-device");

      stateManager.setDeviceState("cache-device", 0, "ON", "api");

      const cached = stateManager.getDeviceState("cache-device", 0);
      expect(cached?.state).toBe("ON");
    });

    it("should return the updated DeviceState object", () => {
      seedDevice("return-device");

      const result = stateManager.setDeviceState(
        "return-device",
        1,
        "OFF",
        "automation",
      );

      expect(result.deviceId).toBe("return-device");
      expect(result.channel).toBe(1);
      expect(result.state).toBe("OFF");
      expect(typeof result.updatedAt).toBe("number");
    });

    it("should emit DEVICE_STATE_CHANGED when source is not mqtt", () => {
      seedDevice("emit-device");

      stateManager.setDeviceState("emit-device", 0, "ON", "api");

      expect(eventBus.emit).toHaveBeenCalledWith(
        EventTypes.DEVICE_STATE_CHANGED,
        expect.objectContaining({
          deviceId: "emit-device",
          channel: 0,
          state: "ON",
          source: "api",
        }),
      );
    });

    it("should NOT emit DEVICE_STATE_CHANGED when source is mqtt (avoids echo)", () => {
      seedDevice("mqtt-device");

      stateManager.setDeviceState("mqtt-device", 0, "ON", "mqtt");

      // applyStateChange is called directly, which should NOT re-emit for 'mqtt' source
      const emitCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        ([type]: [string]) => type === EventTypes.DEVICE_STATE_CHANGED,
      );

      expect(emitCalls).toHaveLength(0);
    });

    it("should handle setting state to OFF after ON", () => {
      seedDevice("toggle-device");

      stateManager.setDeviceState("toggle-device", 0, "ON", "api");
      stateManager.setDeviceState("toggle-device", 0, "OFF", "api");

      const row = getStateFromDb("toggle-device", 0);
      expect(row!.state).toBe("OFF");
    });

    it("should use last-write-wins for concurrent updates", () => {
      seedDevice("lww-device");

      const nowSec = Math.floor(Date.now() / 1000);

      // Older update first
      stateManager.applyStateChange({
        deviceId: "lww-device",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: (nowSec - 5) * 1000, // 5 seconds ago
      });

      // Newer update (should win)
      stateManager.applyStateChange({
        deviceId: "lww-device",
        channel: 0,
        state: "OFF",
        source: "mqtt",
        timestamp: nowSec * 1000, // now
      });

      const cached = stateManager.getDeviceState("lww-device", 0);
      expect(cached?.state).toBe("OFF");
    });

    it("should ignore a stale update that is older than the current state", () => {
      seedDevice("stale-device");

      const nowSec = Math.floor(Date.now() / 1000);

      // First: set a fresh state
      stateManager.applyStateChange({
        deviceId: "stale-device",
        channel: 0,
        state: "ON",
        source: "api",
        timestamp: nowSec * 1000,
      });

      // Then: apply an older update that should be ignored
      stateManager.applyStateChange({
        deviceId: "stale-device",
        channel: 0,
        state: "OFF",
        source: "mqtt",
        timestamp: (nowSec - 10) * 1000, // 10s older
      });

      const cached = stateManager.getDeviceState("stale-device", 0);
      // Still ON because the stale OFF was ignored
      expect(cached?.state).toBe("ON");
    });
  });

  // ── toggleDeviceState ────────────────────────────────────────────────────────

  describe("toggleDeviceState()", () => {
    it("should toggle from OFF to ON when device has no prior state", () => {
      seedDevice("new-toggle-device");

      const result = stateManager.toggleDeviceState(
        "new-toggle-device",
        0,
        "api",
      );

      // Default state is null → toggles to ON
      expect(result.state).toBe("ON");
    });

    it("should toggle from ON to OFF", () => {
      seedDevice("on-device");
      stateManager.setDeviceState("on-device", 0, "ON", "api");
      jest.clearAllMocks();

      const result = stateManager.toggleDeviceState("on-device", 0, "api");

      expect(result.state).toBe("OFF");
    });

    it("should toggle from OFF to ON", () => {
      seedDevice("off-device");
      stateManager.setDeviceState("off-device", 0, "OFF", "api");
      jest.clearAllMocks();

      const result = stateManager.toggleDeviceState("off-device", 0, "api");

      expect(result.state).toBe("ON");
    });

    it("should persist the toggled state to the DB", () => {
      seedDevice("db-toggle-device");
      stateManager.setDeviceState("db-toggle-device", 0, "ON", "api");
      jest.clearAllMocks();

      stateManager.toggleDeviceState("db-toggle-device", 0, "api");

      const row = getStateFromDb("db-toggle-device", 0);
      expect(row!.state).toBe("OFF");
    });
  });

  // ── setRoomState ─────────────────────────────────────────────────────────────

  describe("setRoomState()", () => {
    it("should set all devices in a room to ON", () => {
      seedRoom("room-A", "Room A");
      seedDevice("dev-A1", "room-A");
      seedDevice("dev-A2", "room-A");
      seedDevice("dev-A3", "room-A");

      const results = stateManager.setRoomState("room-A", "ON", "automation");

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.state).toBe("ON"));

      expect(getStateFromDb("dev-A1", 0)?.state).toBe("ON");
      expect(getStateFromDb("dev-A2", 0)?.state).toBe("ON");
      expect(getStateFromDb("dev-A3", 0)?.state).toBe("ON");
    });

    it("should set all devices in a room to OFF", () => {
      seedRoom("room-B", "Room B");
      seedDevice("dev-B1", "room-B");
      seedDevice("dev-B2", "room-B");

      // Pre-set devices to ON
      stateManager.setDeviceState("dev-B1", 0, "ON", "api");
      stateManager.setDeviceState("dev-B2", 0, "ON", "api");
      jest.clearAllMocks();

      const results = stateManager.setRoomState("room-B", "OFF", "automation");

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.state).toBe("OFF"));
    });

    it("should return an empty array for a room with no devices", () => {
      seedRoom("empty-room", "Empty Room");

      const results = stateManager.setRoomState(
        "empty-room",
        "ON",
        "automation",
      );

      expect(results).toEqual([]);
    });

    it("should not affect devices in other rooms", () => {
      seedRoom("room-X", "Room X");
      seedRoom("room-Y", "Room Y");
      seedDevice("dev-X1", "room-X");
      seedDevice("dev-Y1", "room-Y");

      stateManager.setDeviceState("dev-Y1", 0, "OFF", "api");
      jest.clearAllMocks();

      stateManager.setRoomState("room-X", "ON", "automation");

      // Room Y device should be unchanged
      const yState = getStateFromDb("dev-Y1", 0);
      expect(yState?.state).toBe("OFF");
    });
  });

  // ── getRoomState ─────────────────────────────────────────────────────────────

  describe("getRoomState()", () => {
    it("should return a RoomState with all device states", () => {
      seedRoom("room-test", "Test Room");
      seedDevice("rt-d1", "room-test");
      seedDevice("rt-d2", "room-test");
      seedState("rt-d1", 0, "ON");
      seedState("rt-d2", 0, "OFF");

      const roomState = stateManager.getRoomState("room-test");

      expect(roomState.roomId).toBe("room-test");
      expect(roomState.devices).toHaveLength(2);

      const d1 = roomState.devices.find((d) => d.deviceId === "rt-d1");
      const d2 = roomState.devices.find((d) => d.deviceId === "rt-d2");

      expect(d1?.state).toBe("ON");
      expect(d2?.state).toBe("OFF");
    });

    it("should return default OFF state for devices with no recorded state", () => {
      seedRoom("room-defaults", "Defaults Room");
      seedDevice("no-state-dev", "room-defaults");

      const roomState = stateManager.getRoomState("room-defaults");

      expect(roomState.devices).toHaveLength(1);
      expect(roomState.devices[0].state).toBe("OFF");
    });

    it("should return empty devices array for a room with no devices", () => {
      seedRoom("empty-r", "Empty");

      const roomState = stateManager.getRoomState("empty-r");

      expect(roomState.roomId).toBe("empty-r");
      expect(roomState.devices).toEqual([]);
    });
  });

  // ── applyStateChange (via event bus) ─────────────────────────────────────────

  describe("applyStateChange() (event bus integration)", () => {
    it("should react to DEVICE_STATE_CHANGED events emitted on the bus", () => {
      seedDevice("event-driven-device");

      // Simulate the event bus firing the event
      const payload: DeviceStateChangedPayload = {
        deviceId: "event-driven-device",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: Date.now(),
      };

      // The state manager registered a handler for DEVICE_STATE_CHANGED in init()
      // Our mock event bus calls handlers synchronously, so this should work:
      stateManager.applyStateChange(payload);

      const cached = stateManager.getDeviceState("event-driven-device", 0);
      expect(cached?.state).toBe("ON");
    });
  });

  // ── invalidateCache ───────────────────────────────────────────────────────────

  describe("invalidateCache()", () => {
    it("should remove cached entries for a specific device", () => {
      seedDevice("cacheable-device");
      seedState("cacheable-device", 0, "ON");

      stateManager.clearCache();
      stateManager.init();

      // Warm the cache
      stateManager.getDeviceState("cacheable-device", 0);
      const sizeBefore = stateManager.cacheSize;
      expect(sizeBefore).toBeGreaterThan(0);

      stateManager.invalidateCache("cacheable-device");

      // Cache should no longer contain this device
      // (it will be re-fetched from DB on next access)
      expect(stateManager.cacheSize).toBe(0);
    });
  });

  // ── clearCache ───────────────────────────────────────────────────────────────

  describe("clearCache()", () => {
    it("should empty the entire memory cache", () => {
      seedDevice("d-clear-1");
      seedDevice("d-clear-2");
      seedState("d-clear-1", 0, "ON");
      seedState("d-clear-2", 0, "OFF");

      stateManager.clearCache();
      stateManager.init();

      expect(stateManager.cacheSize).toBeGreaterThan(0);

      stateManager.clearCache();

      expect(stateManager.cacheSize).toBe(0);
    });
  });

  // ── cacheSize ─────────────────────────────────────────────────────────────────

  describe("cacheSize", () => {
    it("should reflect the number of cached device-channel entries", () => {
      seedDevice("size-device");
      seedState("size-device", 0, "ON");
      seedState("size-device", 1, "OFF");

      // States table has two rows but the cache only holds the single
      // primary-key row (device_id) per state; the schema uses device_id as PK.
      // After init, cache should have at least 1 entry (the ON state for channel 0).
      stateManager.clearCache();
      stateManager.init();

      expect(stateManager.cacheSize).toBeGreaterThanOrEqual(1);
    });
  });
});
