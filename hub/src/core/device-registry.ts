import { getDb, DbDevice, DbRoom, DbHeartbeat } from '../db/index.js';
import { createLogger } from '../system/logger.js';
import {
  eventBus,
  EventTypes,
  DeviceRegisteredPayload,
  DeviceHeartbeatPayload,
} from './event-bus.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

const log = createLogger('device-registry');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  roomId: string | null;
  type: string;
  name: string | null;
  ipAddress: string | null;
  firmwareVersion: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceWithStatus extends Device {
  online: boolean;
  lastSeen: number | null;
}

export interface Room {
  id: string;
  name: string;
  propertyId: string;
  createdAt: number;
}

export interface RegisterDeviceInput {
  deviceId?: string;
  roomId?: string;
  type?: string;
  name?: string;
  ipAddress?: string;
  firmwareVersion?: string;
}

export interface UpdateDeviceInput {
  roomId?: string;
  name?: string;
  ipAddress?: string;
  firmwareVersion?: string;
}

export interface CreateRoomInput {
  name: string;
  propertyId?: string;
}

// ─── Device Registry ──────────────────────────────────────────────────────────

class DeviceRegistry {
  // In-memory set of known device IDs for fast existence checks
  private knownDeviceIds: Set<string> = new Set();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  init(): void {
    this.loadKnownDevices();
    this.subscribeToEvents();
    log.info({ knownDevices: this.knownDeviceIds.size }, 'Device registry initialized');
  }

  private loadKnownDevices(): void {
    const db = getDb();
    const rows = db
      .prepare<[], { id: string }>('SELECT id FROM devices')
      .all();

    for (const row of rows) {
      this.knownDeviceIds.add(row.id);
    }

    log.debug({ count: this.knownDeviceIds.size }, 'Known devices loaded');
  }

  private subscribeToEvents(): void {
    // Auto-register devices that announce themselves via MQTT discovery
    eventBus.on(EventTypes.DEVICE_REGISTERED, (payload) => {
      this.handleDeviceDiscovery(payload);
    });

    // Update heartbeat / online status
    eventBus.on(EventTypes.DEVICE_HEARTBEAT, (payload) => {
      this.handleHeartbeat(payload);
    });
  }

  // ── Device CRUD ─────────────────────────────────────────────────────────────

  /**
   * Register a new device or update an existing one if already known.
   * This is idempotent — safe to call on every discovery message.
   */
  registerDevice(input: RegisterDeviceInput): Device {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const id = input.deviceId ?? uuidv4();

    if (this.knownDeviceIds.has(id)) {
      // Device already registered — update metadata if provided
      return this.updateDevice(id, {
        roomId: input.roomId,
        name: input.name,
        ipAddress: input.ipAddress,
        firmwareVersion: input.firmwareVersion,
      });
    }

    db.prepare<[string, string | null, string, string | null, string | null, string | null, number, number]>(`
      INSERT INTO devices (id, room_id, type, name, ip_address, firmware_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.roomId ?? null,
      input.type ?? 'relay',
      input.name ?? null,
      input.ipAddress ?? null,
      input.firmwareVersion ?? null,
      now,
      now,
    );

    // Seed a default heartbeat row so health monitoring can track it
    db.prepare<[string, number]>(`
      INSERT INTO heartbeats (device_id, last_seen, online)
      VALUES (?, ?, 1)
      ON CONFLICT (device_id) DO NOTHING
    `).run(id, now);

    this.knownDeviceIds.add(id);

    log.info({ deviceId: id, type: input.type, roomId: input.roomId }, 'Device registered');

    return this.getDeviceOrThrow(id);
  }

  /**
   * Update mutable metadata for an existing device.
   */
  updateDevice(deviceId: string, input: UpdateDeviceInput): Device {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Build SET clause dynamically from provided fields
    const setClauses: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (input.roomId !== undefined) {
      setClauses.push('room_id = ?');
      values.push(input.roomId);
    }
    if (input.name !== undefined) {
      setClauses.push('name = ?');
      values.push(input.name);
    }
    if (input.ipAddress !== undefined) {
      setClauses.push('ip_address = ?');
      values.push(input.ipAddress);
    }
    if (input.firmwareVersion !== undefined) {
      setClauses.push('firmware_version = ?');
      values.push(input.firmwareVersion);
    }

    values.push(deviceId);

    db.prepare(`
      UPDATE devices SET ${setClauses.join(', ')} WHERE id = ?
    `).run(...values);

    log.info({ deviceId, changes: input }, 'Device updated');

    eventBus.emit(EventTypes.DEVICE_UPDATED, {
      deviceId,
      changes: {
        roomId: input.roomId,
        name: input.name,
        ipAddress: input.ipAddress,
        firmwareVersion: input.firmwareVersion,
      },
      timestamp: Date.now(),
    });

    return this.getDeviceOrThrow(deviceId);
  }

  /**
   * Remove a device and all associated state/heartbeat records.
   */
  removeDevice(deviceId: string): void {
    if (!this.knownDeviceIds.has(deviceId)) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    const db = getDb();

    db.prepare('DELETE FROM devices WHERE id = ?').run(deviceId);
    this.knownDeviceIds.delete(deviceId);

    log.info({ deviceId }, 'Device removed');

    eventBus.emit(EventTypes.DEVICE_REMOVED, {
      deviceId,
      timestamp: Date.now(),
    });
  }

  // ── Device Reads ────────────────────────────────────────────────────────────

  getDevice(deviceId: string): Device | null {
    const db = getDb();
    const row = db
      .prepare<[string], DbDevice>(
        'SELECT id, room_id, type, name, ip_address, firmware_version, created_at, updated_at FROM devices WHERE id = ?'
      )
      .get(deviceId);

    return row ? this.mapDevice(row) : null;
  }

  getDeviceOrThrow(deviceId: string): Device {
    const device = this.getDevice(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    return device;
  }

  /**
   * Get device enriched with current online status.
   */
  getDeviceWithStatus(deviceId: string): DeviceWithStatus | null {
    const device = this.getDevice(deviceId);
    if (!device) return null;

    const db = getDb();
    const hb = db
      .prepare<[string], DbHeartbeat>(
        'SELECT device_id, last_seen, online FROM heartbeats WHERE device_id = ?'
      )
      .get(deviceId);

    const onlineThreshold =
      Math.floor(Date.now() / 1000) - config.health.deviceOfflineThresholdSeconds;

    return {
      ...device,
      online: hb ? hb.online === 1 && hb.last_seen >= onlineThreshold : false,
      lastSeen: hb ? hb.last_seen : null,
    };
  }

  listDevices(): Device[] {
    const db = getDb();
    const rows = db
      .prepare<[], DbDevice>(
        'SELECT id, room_id, type, name, ip_address, firmware_version, created_at, updated_at FROM devices ORDER BY created_at DESC'
      )
      .all();

    return rows.map((row) => this.mapDevice(row));
  }

  listDevicesWithStatus(): DeviceWithStatus[] {
    const db = getDb();

    const rows = db.prepare<[], DbDevice & Partial<DbHeartbeat>>(`
      SELECT
        d.id, d.room_id, d.type, d.name, d.ip_address, d.firmware_version,
        d.created_at, d.updated_at,
        h.last_seen, h.online
      FROM devices d
      LEFT JOIN heartbeats h ON h.device_id = d.id
      ORDER BY d.created_at DESC
    `).all();

    const onlineThreshold =
      Math.floor(Date.now() / 1000) - config.health.deviceOfflineThresholdSeconds;

    return rows.map((row) => ({
      ...this.mapDevice(row),
      online: row.online === 1 && (row.last_seen ?? 0) >= onlineThreshold,
      lastSeen: row.last_seen ?? null,
    }));
  }

  listDevicesByRoom(roomId: string): DeviceWithStatus[] {
    const db = getDb();

    const rows = db.prepare<[string], DbDevice & Partial<DbHeartbeat>>(`
      SELECT
        d.id, d.room_id, d.type, d.name, d.ip_address, d.firmware_version,
        d.created_at, d.updated_at,
        h.last_seen, h.online
      FROM devices d
      LEFT JOIN heartbeats h ON h.device_id = d.id
      WHERE d.room_id = ?
      ORDER BY d.created_at ASC
    `).all(roomId);

    const onlineThreshold =
      Math.floor(Date.now() / 1000) - config.health.deviceOfflineThresholdSeconds;

    return rows.map((row) => ({
      ...this.mapDevice(row),
      online: row.online === 1 && (row.last_seen ?? 0) >= onlineThreshold,
      lastSeen: row.last_seen ?? null,
    }));
  }

  isKnownDevice(deviceId: string): boolean {
    return this.knownDeviceIds.has(deviceId);
  }

  // ── Room CRUD ───────────────────────────────────────────────────────────────

  createRoom(input: CreateRoomInput): Room {
    const db = getDb();
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const propertyId = input.propertyId ?? config.hub.propertyId;

    db.prepare<[string, string, string, number]>(`
      INSERT INTO rooms (id, name, property_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, input.name, propertyId, now);

    log.info({ roomId: id, name: input.name, propertyId }, 'Room created');

    return this.getRoomOrThrow(id);
  }

  getRoom(roomId: string): Room | null {
    const db = getDb();
    const row = db
      .prepare<[string], DbRoom>(
        'SELECT id, name, property_id, created_at FROM rooms WHERE id = ?'
      )
      .get(roomId);

    return row ? this.mapRoom(row) : null;
  }

  getRoomOrThrow(roomId: string): Room {
    const room = this.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);
    return room;
  }

  listRooms(): Room[] {
    const db = getDb();
    const rows = db
      .prepare<[], DbRoom>(
        'SELECT id, name, property_id, created_at FROM rooms ORDER BY name ASC'
      )
      .all();

    return rows.map((row) => this.mapRoom(row));
  }

  updateRoom(roomId: string, input: Partial<CreateRoomInput>): Room {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      setClauses.push('name = ?');
      values.push(input.name);
    }
    if (input.propertyId !== undefined) {
      setClauses.push('property_id = ?');
      values.push(input.propertyId);
    }

    if (setClauses.length === 0) return this.getRoomOrThrow(roomId);

    values.push(roomId);
    db.prepare(`UPDATE rooms SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    log.info({ roomId, changes: input }, 'Room updated');

    return this.getRoomOrThrow(roomId);
  }

  deleteRoom(roomId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    log.info({ roomId }, 'Room deleted');
  }

  // ── Heartbeat / Health ──────────────────────────────────────────────────────

  /**
   * Mark all devices that haven't sent a heartbeat recently as offline.
   * Called periodically by the health monitor.
   */
  markStaleDevicesOffline(): string[] {
    const db = getDb();
    const threshold = Math.floor(Date.now() / 1000) - config.health.deviceOfflineThresholdSeconds;

    const staleRows = db
      .prepare<[number], { device_id: string }>(
        'SELECT device_id FROM heartbeats WHERE online = 1 AND last_seen < ?'
      )
      .all(threshold);

    if (staleRows.length === 0) return [];

    const stmt = db.prepare('UPDATE heartbeats SET online = 0 WHERE device_id = ?');

    const offlineDeviceIds: string[] = [];

    const markOffline = db.transaction(() => {
      for (const row of staleRows) {
        stmt.run(row.device_id);
        offlineDeviceIds.push(row.device_id);
      }
    });

    markOffline();

    for (const deviceId of offlineDeviceIds) {
      log.warn({ deviceId }, 'Device marked offline (heartbeat timeout)');
      eventBus.emit(EventTypes.DEVICE_OFFLINE, {
        deviceId,
        lastSeen: 0,
        timestamp: Date.now(),
      });
    }

    return offlineDeviceIds;
  }

  getOnlineCount(): number {
    const db = getDb();
    const threshold = Math.floor(Date.now() / 1000) - config.health.deviceOfflineThresholdSeconds;
    const row = db
      .prepare<[number], { count: number }>(
        'SELECT COUNT(*) as count FROM heartbeats WHERE online = 1 AND last_seen >= ?'
      )
      .get(threshold);
    return row?.count ?? 0;
  }

  getTotalCount(): number {
    return this.knownDeviceIds.size;
  }

  // ── Event Handlers ──────────────────────────────────────────────────────────

  private handleDeviceDiscovery(payload: DeviceRegisteredPayload): void {
    const { deviceId, roomId, type, ipAddress, timestamp } = payload;

    if (this.knownDeviceIds.has(deviceId)) {
      // Known device — update metadata
      this.updateDevice(deviceId, {
        roomId,
        ipAddress,
      });
    } else {
      // New device — auto-register
      this.registerDevice({
        deviceId,
        roomId,
        type: type ?? 'relay',
        ipAddress,
        firmwareVersion: undefined,
      });
    }

    // Record initial heartbeat
    this.recordHeartbeat(deviceId, timestamp);
  }

  private handleHeartbeat(payload: DeviceHeartbeatPayload): void {
    const { deviceId, ipAddress, firmwareVersion, timestamp } = payload;

    // Auto-register unknown devices that send heartbeats
    if (!this.knownDeviceIds.has(deviceId)) {
      log.info({ deviceId }, 'Unknown device sent heartbeat — auto-registering');
      this.registerDevice({ deviceId, ipAddress, firmwareVersion });
    }

    // Update IP / firmware if provided
    if (ipAddress || firmwareVersion) {
      this.updateDevice(deviceId, { ipAddress, firmwareVersion });
    }

    this.recordHeartbeat(deviceId, timestamp);

    eventBus.emit(EventTypes.DEVICE_ONLINE, {
      deviceId,
      timestamp,
    });
  }

  private recordHeartbeat(deviceId: string, timestamp: number): void {
    const db = getDb();
    const nowSec = Math.floor(timestamp / 1000);

    db.prepare<[string, number]>(`
      INSERT INTO heartbeats (device_id, last_seen, online)
      VALUES (?, ?, 1)
      ON CONFLICT (device_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        online    = 1
      WHERE excluded.last_seen >= heartbeats.last_seen
    `).run(deviceId, nowSec);
  }

  // ── Mapping Helpers ─────────────────────────────────────────────────────────

  private mapDevice(row: DbDevice): Device {
    return {
      id: row.id,
      roomId: row.room_id,
      type: row.type,
      name: row.name,
      ipAddress: row.ip_address,
      firmwareVersion: row.firmware_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRoom(row: DbRoom): Room {
    return {
      id: row.id,
      name: row.name,
      propertyId: row.property_id,
      createdAt: row.created_at,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const deviceRegistry = new DeviceRegistry();
