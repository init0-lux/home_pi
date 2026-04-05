import { getDb, DbState, DbDevice } from "../db/index.js";
import { createLogger } from "../system/logger.js";
import {
  eventBus,
  EventTypes,
  DeviceStateChangedPayload,
} from "./event-bus.js";

const log = createLogger("state-manager");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceState {
  deviceId: string;
  channel: number;
  state: "ON" | "OFF";
  updatedAt: number;
}

export interface RoomState {
  roomId: string;
  devices: DeviceState[];
}

// ─── State Manager ────────────────────────────────────────────────────────────

class StateManager {
  /** In-memory write-through cache. Key: `${deviceId}:${channel}` */
  private cache = new Map<string, DeviceState>();

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Load all persisted states into the cache and subscribe to bus events.
   * Call this once during boot before starting the MQTT gateway.
   */
  init(): void {
    this.loadFromDb();
    this.subscribeToEvents();
    log.info({ cachedDevices: this.cache.size }, "State manager initialized");
  }

  private loadFromDb(): void {
    const db = getDb();
    const rows = db
      .prepare<[], DbState>(
        "SELECT device_id, channel, state, updated_at FROM states",
      )
      .all();

    for (const row of rows) {
      const key = cacheKey(row.device_id, row.channel);
      this.cache.set(key, {
        deviceId:  row.device_id,
        channel:   row.channel,
        state:     row.state,
        updatedAt: row.updated_at,
      });
    }

    log.debug({ count: rows.length }, "Device states loaded from DB");
  }

  private subscribeToEvents(): void {
    // React to state changes that arrive via MQTT
    eventBus.on(EventTypes.DEVICE_STATE_CHANGED, (payload) => {
      this.applyStateChange(payload);
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────

  /**
   * Get the current state of a single device channel.
   * Hits the cache first; falls back to DB on a miss.
   */
  getDeviceState(deviceId: string, channel = 0): DeviceState | null {
    const key = cacheKey(deviceId, channel);
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Cache miss — query DB
    const db = getDb();
    const row = db
      .prepare<[string, number], DbState>(
        "SELECT device_id, channel, state, updated_at FROM states WHERE device_id = ? AND channel = ?",
      )
      .get(deviceId, channel);

    if (!row) return null;

    const state: DeviceState = {
      deviceId:  row.device_id,
      channel:   row.channel,
      state:     row.state,
      updatedAt: row.updated_at,
    };

    this.cache.set(key, state);
    return state;
  }

  /**
   * Get all channel states for a single device.
   */
  getDeviceStates(deviceId: string): DeviceState[] {
    const db = getDb();
    const rows = db
      .prepare<[string], DbState>(
        "SELECT device_id, channel, state, updated_at FROM states WHERE device_id = ?",
      )
      .all(deviceId);

    return rows.map((row) => ({
      deviceId:  row.device_id,
      channel:   row.channel,
      state:     row.state,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get all device states for an entire room.
   * Devices with no recorded state are returned with a default of OFF.
   */
  getRoomState(roomId: string): RoomState {
    const db = getDb();
    const devices = db
      .prepare<[string], DbDevice>(
        "SELECT id, room_id, type, name, ip_address, firmware_version, created_at, updated_at FROM devices WHERE room_id = ?",
      )
      .all(roomId);

    const deviceStates: DeviceState[] = [];

    for (const device of devices) {
      const states = this.getDeviceStates(device.id);
      if (states.length > 0) {
        deviceStates.push(...states);
      } else {
        // No recorded state → report default OFF so the dashboard has a value
        deviceStates.push({
          deviceId:  device.id,
          channel:   0,
          state:     "OFF",
          updatedAt: device.created_at,
        });
      }
    }

    return { roomId, devices: deviceStates };
  }

  /**
   * Flat snapshot of every device state — useful for the dashboard overview.
   */
  getAllStates(): DeviceState[] {
    const db = getDb();
    const rows = db
      .prepare<[], DbState>(
        "SELECT device_id, channel, state, updated_at FROM states ORDER BY device_id, channel",
      )
      .all();

    return rows.map((row) => ({
      deviceId:  row.device_id,
      channel:   row.channel,
      state:     row.state,
      updatedAt: row.updated_at,
    }));
  }

  // ── Writes ────────────────────────────────────────────────────────────────────

  /**
   * Apply a state change from any source.
   *
   * 1. Persist to DB (upsert, last-write-wins on timestamp).
   * 2. Update the in-memory cache.
   *
   * Called by the event bus subscriber (for MQTT-sourced changes)
   * and directly by setDeviceState / setRoomState (for API-sourced changes).
   */
  applyStateChange(payload: DeviceStateChangedPayload): void {
    const { deviceId, channel, state, timestamp } = payload;
    const nowSec = Math.floor(timestamp / 1000);

    // ── 1. Persist ────────────────────────────────────────────────────────────
    const db = getDb();
    db.prepare<[string, number, string, number]>(`
      INSERT INTO states (device_id, channel, state, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (device_id) DO UPDATE SET
        channel    = excluded.channel,
        state      = excluded.state,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= states.updated_at
    `).run(deviceId, channel, state, nowSec);

    // ── 2. Update cache (last-write-wins) ─────────────────────────────────────
    const key = cacheKey(deviceId, channel);
    const existing = this.cache.get(key);

    if (!existing || nowSec >= existing.updatedAt) {
      this.cache.set(key, { deviceId, channel, state, updatedAt: nowSec });
      log.info(
        { deviceId, channel, state, source: payload.source },
        "Device state updated",
      );
    } else {
      log.debug(
        { deviceId, channel, state, source: payload.source },
        "Stale state update ignored",
      );
    }
  }

  /**
   * Set a device channel to a specific state from API or automation.
   *
   * This is the primary outbound control path:
   *   1. Persists to DB
   *   2. Updates cache
   *   3. Re-emits DEVICE_STATE_CHANGED so the MQTT gateway can forward the
   *      command to the physical device (unless the source was already "mqtt",
   *      to avoid echo loops).
   */
  setDeviceState(
    deviceId: string,
    channel: number,
    state: "ON" | "OFF",
    source: DeviceStateChangedPayload["source"] = "api",
  ): DeviceState {
    const timestamp = Date.now();

    const payload: DeviceStateChangedPayload = {
      deviceId,
      channel,
      state,
      source,
      timestamp,
    };

    this.applyStateChange(payload);

    if (source !== "mqtt") {
      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, payload);
    }

    return {
      deviceId,
      channel,
      state,
      updatedAt: Math.floor(timestamp / 1000),
    };
  }

  /**
   * Toggle the current state of a device channel.
   * Devices with no recorded state default to OFF → first toggle turns them ON.
   */
  toggleDeviceState(
    deviceId: string,
    channel = 0,
    source: DeviceStateChangedPayload["source"] = "api",
  ): DeviceState {
    const current = this.getDeviceState(deviceId, channel);
    const newState: "ON" | "OFF" = current?.state === "ON" ? "OFF" : "ON";
    return this.setDeviceState(deviceId, channel, newState, source);
  }

  /**
   * Set all devices in a room to the same state.
   * Used by the automation engine for guest check-in/out and room-level API calls.
   */
  setRoomState(
    roomId: string,
    state: "ON" | "OFF",
    source: DeviceStateChangedPayload["source"] = "automation",
  ): DeviceState[] {
    const db = getDb();
    const devices = db
      .prepare<[string], { id: string }>(
        "SELECT id FROM devices WHERE room_id = ?",
      )
      .all(roomId);

    const results: DeviceState[] = [];

    for (const device of devices) {
      results.push(this.setDeviceState(device.id, 0, state, source));
    }

    log.info(
      { roomId, state, deviceCount: results.length, source },
      "Room state set",
    );

    return results;
  }

  // ── Cache Management ──────────────────────────────────────────────────────────

  /** Remove all cache entries for a device, forcing DB reads on next access. */
  invalidateCache(deviceId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${deviceId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /** Wipe the entire in-memory cache. */
  clearCache(): void {
    this.cache.clear();
    log.debug("State cache cleared");
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cacheKey(deviceId: string, channel: number): string {
  return `${deviceId}:${channel}`;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const stateManager = new StateManager();
