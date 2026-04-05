import { getDb, DbState, DbDevice } from '../db/index.js';
import { createLogger } from '../system/logger.js';
import {
  eventBus,
  EventTypes,
  DeviceStateChangedPayload,
} from './event-bus.js';

const log = createLogger('state-manager');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceState {
  deviceId: string;
  channel: number;
  state: 'ON' | 'OFF';
  updatedAt: number;
}

export interface RoomState {
  roomId: string;
  devices: DeviceState[];
}

// ─── State Manager ────────────────────────────────────────────────────────────

class StateManager {
  private memoryCache: Map<string, DeviceState> = new Map();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Initialize: load all persisted states into memory cache.
   * Subscribe to DEVICE_STATE_CHANGED events from the event bus.
   */
  init(): void {
    this.loadFromDb();
    this.subscribeToEvents();
    log.info({ cachedDevices: this.memoryCache.size }, 'State manager initialized');
  }

  private loadFromDb(): void {
    const db = getDb();
    const rows = db
      .prepare<[], DbState>('SELECT device_id, channel, state, updated_at FROM states')
      .all();

    for (const row of rows) {
      const key = this.cacheKey(row.device_id, row.channel);
      this.memoryCache.set(key, {
        deviceId: row.device_id,
        channel: row.channel,
        state: row.state,
        updatedAt: row.updated_at,
      });
    }

    log.debug({ count: rows.length }, 'Device states loaded from DB');
  }

  private subscribeToEvents(): void {
    eventBus.on(EventTypes.DEVICE_STATE_CHANGED, (payload) => {
      this.applyStateChange(payload);
    });
  }

  // ── State Reads ─────────────────────────────────────────────────────────────

  /**
   * Get state of a single device channel from in-memory cache.
   * Falls back to DB if not cached.
   */
  getDeviceState(deviceId: string, channel = 0): DeviceState | null {
    const key = this.cacheKey(deviceId, channel);
    const cached = this.memoryCache.get(key);
    if (cached) return cached;

    // Cache miss: try DB
    const db = getDb();
    const row = db
      .prepare<[string, number], DbState>(
        'SELECT device_id, channel, state, updated_at FROM states WHERE device_id = ? AND channel = ?'
      )
      .get(deviceId, channel);

    if (!row) return null;

    const state: DeviceState = {
      deviceId: row.device_id,
      channel: row.channel,
      state: row.state,
      updatedAt: row.updated_at,
    };

    this.memoryCache.set(key, state);
    return state;
  }

  /**
   * Get all channel states for a device.
   */
  getDeviceStates(deviceId: string): DeviceState[] {
    const db = getDb();
    const rows = db
      .prepare<[string], DbState>(
        'SELECT device_id, channel, state, updated_at FROM states WHERE device_id = ?'
      )
      .all(deviceId);

    return rows.map((row) => ({
      deviceId: row.device_id,
      channel: row.channel,
      state: row.state,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get all device states for a room.
   */
  getRoomState(roomId: string): RoomState {
    const db = getDb();

    const devices = db
      .prepare<[string], DbDevice>(
        'SELECT id, room_id, type, name, ip_address, firmware_version, created_at, updated_at FROM devices WHERE room_id = ?'
      )
      .all(roomId);

    const deviceStates: DeviceState[] = [];

    for (const device of devices) {
      const states = this.getDeviceStates(device.id);
      if (states.length > 0) {
        deviceStates.push(...states);
      } else {
        // Device exists but has no state yet — report default OFF
        deviceStates.push({
          deviceId: device.id,
          channel: 0,
          state: 'OFF',
          updatedAt: device.created_at,
        });
      }
    }

    return { roomId, devices: deviceStates };
  }

  /**
   * Get a flat snapshot of all device states (for API/dashboard).
   */
  getAllStates(): DeviceState[] {
    const db = getDb();
    const rows = db
      .prepare<[], DbState>('SELECT device_id, channel, state, updated_at FROM states ORDER BY device_id, channel')
      .all();

    return rows.map((row) => ({
      deviceId: row.device_id,
      channel: row.channel,
      state: row.state,
      updatedAt: row.updated_at,
    }));
  }

  // ── State Writes ────────────────────────────────────────────────────────────

  /**
   * Apply a state change:
   *  1. Persist to DB (upsert)
   *  2. Update in-memory cache
   *  3. Emit DEVICE_STATE_CHANGED so subscribers react
   *
   * Called by event bus subscriber AND directly by the API layer
   * (API calls this directly to ensure hub is always authoritative).
   */
  applyStateChange(payload: DeviceStateChangedPayload): void {
    const { deviceId, channel, state, source, timestamp } = payload;

    const nowSec = Math.floor(timestamp / 1000);

    // ── 1. Persist ───────────────────────────────────────────────────────────
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

    // ── 2. Update cache ──────────────────────────────────────────────────────
    const key = this.cacheKey(deviceId, channel);
    const existing = this.memoryCache.get(key);

    // Last-write-wins: only update cache if this is newer
    if (!existing || nowSec >= existing.updatedAt) {
      this.memoryCache.set(key, { deviceId, channel, state, updatedAt: nowSec });
      log.info({ deviceId, channel, state, source }, 'Device state updated');
    } else {
      log.debug({ deviceId, channel, state, source }, 'Stale state update ignored');
    }
  }

  /**
   * Directly set a device state (e.g. from the API or automation engine).
   * This is the entry point for outbound control — it persists, caches,
   * and emits the event so the MQTT gateway can forward the command.
   */
  setDeviceState(
    deviceId: string,
    channel: number,
    state: 'ON' | 'OFF',
    source: DeviceStateChangedPayload['source'] = 'api'
  ): DeviceState {
    const timestamp = Date.now();

    const payload: DeviceStateChangedPayload = {
      deviceId,
      channel,
      state,
      source,
      timestamp,
    };

    // Apply locally first (hub is authoritative)
    this.applyStateChange(payload);

    // Re-emit so the MQTT gateway can publish the command to the device
    // (only if source isn't already 'mqtt' to avoid echo loops)
    if (source !== 'mqtt') {
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
   */
  toggleDeviceState(
    deviceId: string,
    channel = 0,
    source: DeviceStateChangedPayload['source'] = 'api'
  ): DeviceState {
    const current = this.getDeviceState(deviceId, channel);
    const newState: 'ON' | 'OFF' = current?.state === 'ON' ? 'OFF' : 'ON';
    return this.setDeviceState(deviceId, channel, newState, source);
  }

  /**
   * Set all channels in a room to a given state.
   * Used by automation engine and PMS check-in flow.
   */
  setRoomState(
    roomId: string,
    state: 'ON' | 'OFF',
    source: DeviceStateChangedPayload['source'] = 'automation'
  ): DeviceState[] {
    const db = getDb();

    const devices = db
      .prepare<[string], { id: string }>(
        'SELECT id FROM devices WHERE room_id = ?'
      )
      .all(roomId);

    const results: DeviceState[] = [];

    for (const device of devices) {
      const stateResult = this.setDeviceState(device.id, 0, state, source);
      results.push(stateResult);
    }

    log.info({ roomId, state, deviceCount: results.length, source }, 'Room state set');

    return results;
  }

  // ── Cache Management ────────────────────────────────────────────────────────

  /**
   * Invalidate the cache for a specific device. Forces a DB read on next access.
   */
  invalidateCache(deviceId: string): void {
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`${deviceId}:`)) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Clear the entire memory cache. Useful for testing or after a hub restart.
   */
  clearCache(): void {
    this.memoryCache.clear();
    log.debug('State cache cleared');
  }

  get cacheSize(): number {
    return this.memoryCache.size;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private cacheKey(deviceId: string, channel: number): string {
    return `${deviceId}:${channel}`;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const stateManager = new StateManager();
