import { getDb, DbDevice, DbRoom, DbHeartbeat } from "../db/index.js";
import { createLogger } from "../system/logger.js";
import {
  eventBus,
  EventTypes,
  DeviceRegisteredPayload,
  DeviceHeartbeatPayload,
} from "./event-bus.js";
import { config } from "../config/index.js";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("device-registry");

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
  /** Fast existence checks without hitting the DB */
  private knownDeviceIds = new Set<string>();

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  init(): void {
    this.loadKnownDevices();
    this.subscribeToEvents();
    log.info({ knownDevices: this.knownDeviceIds.size }, "Device registry initialized");
  }

  private loadKnownDevices(): void {
    const db = getDb();
    const rows = db
      .prepare<[], { id: string }>("SELECT id FROM devices")
      .all();

    for (const row of rows) {
      this.knownDeviceIds.add(row.id);
    }

    log.debug({ count: this.knownDeviceIds.size }, "Known devices loaded");
  }

  private subscribeToEvents(): void {
    eventBus.on(EventTypes.DEVICE_REGISTERED, (payload) => {
      this.handleDiscovery(payload);
    });

    eventBus.on(EventTypes.DEVICE_HEARTBEAT, (payload) => {
      this.handleHeartbeat(payload);
    });
  }

  // ── Device CRUD ───────────────────────────────────────────────────────────────

  /**
   * Register a new device, or update metadata if it already exists.
   * Idempotent — safe to call on every MQTT discovery message.
   */
  registerDevice(input: RegisterDeviceInput): Device {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const id = input.deviceId ?? uuidv4();

    if (this.knownDeviceIds.has(id)) {
      return this.updateDevice(id, {
        roomId:          input.roomId,
        name:            input.name,
        ipAddress:       input.ipAddress,
        firmwareVersion: input.firmwareVersion,
      });
    }

    db.prepare<[string, string | null, string, string | null, string | null, string | null, number, number]>(`
      INSERT INTO devices (id, room_id, type, name, ip_address, firmware_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.roomId         ?? null,
      input.type           ?? "relay",
      input.name           ?? null,
      input.ipAddress      ?? null,
      input.firmwareVersion ?? null,
      now,
      now,
    );

    // Seed an initial heartbeat row for health monitoring
    db.prepare<[string, number]>(`
      INSERT INTO heartbeats (device_id, last_seen, online)
      VALUES (?, ?, 1)
      ON CONFLICT (device_id) DO NOTHING
    `).run(id, now);

    this.knownDeviceIds.add(id);

    log.info(
      { deviceId: id, type: input.type, roomId: input.roomId },
      "Device registered",
    );

    return this.getDeviceOrThrow(id);
  }

  /**
   * Update mutable metadata on an existing device.
   * Only provided (non-undefined) fields are touched.
   */
  updateDevice(deviceId: string, input: UpdateDeviceInput): Device {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const setClauses: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (input.roomId !== undefined) {
      setClauses.push("room_id = ?");
      values.push(input.roomId);
    }
    if (input.name !== undefined) {
      setClauses.push("name = ?");
      values.push(input.name);
    }
    if (input.ipAddress !== undefined) {
      setClauses.push("ip_address = ?");
      values.push(input.ipAddress);
    }
    if (input.firmwareVersion !== undefined) {
      setClauses.push("firmware_version = ?");
      values.push(input.firmwareVersion);
    }

    values.push(deviceId);

    db.prepare(
      `UPDATE devices SET ${setClauses.join(", ")} WHERE id = ?`,
    ).run(...values);

    log.info({ deviceId, changes: input }, "Device updated");

    eventBus.emit(EventTypes.DEVICE_UPDATED, {
      deviceId,
      changes: {
        roomId:          input.roomId,
        name:            input.name,
        ipAddress:       input.ipAddress,
        firmwareVersion: input.firmwareVersion,
      },
      timestamp: Date.now(),
    });

    return this.getDeviceOrThrow(deviceId);
  }

  removeDevice(deviceId: string): void {
    if (!this.knownDeviceIds.has(deviceId)) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    const db = getDb();
    db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
    this.knownDeviceIds.delete(deviceId);

    log.info({ deviceId }, "Device removed");

    eventBus.emit(EventTypes.DEVICE_REMOVED, {
      deviceId,
      timestamp: Date.now(),
    });
  }

  // ── Device Reads ──────────────────────────────────────────────────────────────

  getDevice(deviceId: string): Device | null {
    const db = getDb();
    const row = db
      .prepare<[string], DbDevice>(
        "SELECT id, room_id, type, name, ip_address, firmware_version, created_at, updated_at FROM devices WHERE id = ?",
      )
      .get(deviceId);

    return row ? mapDevice(row) : null;
  }

  getDeviceOrThrow(deviceId: string): Device {
    const device = this.getDevice(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    return device;
  }

  getDeviceWithStatus(deviceId: string): DeviceWithStatus | null {
    const device = this.getDevice(deviceId);
    if (!device) return null;

    const db = getDb();
    const hb = db
      .prepare<[string], DbHeartbeat>(
        "SELECT device_id, last_seen, online FROM heartbeats WHERE device_id = ?",
      )
      .get(deviceId);

    return { ...device, ...resolveStatus(hb) };
  }

  listDevices(): Device[] {
    const db = getDb();
    const rows = db
      .prepare<[], DbDevice>(
        "SELECT id, room_id, type, name, ip_address, firmware_version, created_at, updated_at FROM devices ORDER BY created_at DESC",
      )
      .all();

    return rows.map(mapDevice);
  }

  listDevicesWithStatus(): DeviceWithStatus[] {
    const db = getDb();
    const rows = db
      .prepare<[], DbDevice & Partial<DbHeartbeat>>(`
        SELECT
          d.id, d.room_id, d.type, d.name, d.ip_address, d.firmware_version,
          d.created_at, d.updated_at,
          h.last_seen, h.online
        FROM devices d
        LEFT JOIN heartbeats h ON h.device_id = d.id
        ORDER BY d.created_at DESC
      `)
      .all();

    return rows.map((row) => ({
      ...mapDevice(row),
      ...resolveStatus(row.last_seen !== undefined ? (row as DbHeartbeat) : null),
    }));
  }

  listDevicesByRoom(roomId: string): DeviceWithStatus[] {
    const db = getDb();
    const rows = db
      .prepare<[string], DbDevice & Partial<DbHeartbeat>>(`
        SELECT
          d.id, d.room_id, d.type, d.name, d.ip_address, d.firmware_version,
          d.created_at, d.updated_at,
          h.last_seen, h.online
        FROM devices d
        LEFT JOIN heartbeats h ON h.device_id = d.id
        WHERE d.room_id = ?
        ORDER BY d.created_at ASC
      `)
      .all(roomId);

    return rows.map((row) => ({
      ...mapDevice(row),
      ...resolveStatus(row.last_seen !== undefined ? (row as DbHeartbeat) : null),
    }));
  }

  isKnownDevice(deviceId: string): boolean {
    return this.knownDeviceIds.has(deviceId);
  }

  getTotalCount(): number {
    return this.knownDeviceIds.size;
  }

  getOnlineCount(): number {
    const db = getDb();
    const threshold = onlineThreshold();
    const row = db
      .prepare<[number], { count: number }>(
        "SELECT COUNT(*) as count FROM heartbeats WHERE online = 1 AND last_seen >= ?",
      )
      .get(threshold);
    return row?.count ?? 0;
  }

  // ── Room CRUD ─────────────────────────────────────────────────────────────────

  createRoom(input: CreateRoomInput): Room {
    const db = getDb();
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const propertyId = input.propertyId ?? config.hub.propertyId;

    db.prepare<[string, string, string, number]>(`
      INSERT INTO rooms (id, name, property_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, input.name, propertyId, now);

    log.info({ roomId: id, name: input.name, propertyId }, "Room created");

    return this.getRoomOrThrow(id);
  }

  getRoom(roomId: string): Room | null {
    const db = getDb();
    const row = db
      .prepare<[string], DbRoom>(
        "SELECT id, name, property_id, created_at FROM rooms WHERE id = ?",
      )
      .get(roomId);

    return row ? mapRoom(row) : null;
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
        "SELECT id, name, property_id, created_at FROM rooms ORDER BY name ASC",
      )
      .all();

    return rows.map(mapRoom);
  }

  updateRoom(roomId: string, input: Partial<CreateRoomInput>): Room {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      setClauses.push("name = ?");
      values.push(input.name);
    }
    if (input.propertyId !== undefined) {
      setClauses.push("property_id = ?");
      values.push(input.propertyId);
    }

    if (setClauses.length === 0) return this.getRoomOrThrow(roomId);

    values.push(roomId);
    db.prepare(`UPDATE rooms SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);

    log.info({ roomId, changes: input }, "Room updated");

    return this.getRoomOrThrow(roomId);
  }

  deleteRoom(roomId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
    log.info({ roomId }, "Room deleted");
  }

  // ── Health / Heartbeat ────────────────────────────────────────────────────────

  /**
   * Mark devices that have not sent a heartbeat within the configured
   * threshold as offline. Called periodically by the health monitor.
   *
   * Returns the IDs of any devices newly marked offline.
   */
  markStaleDevicesOffline(): string[] {
    const db = getDb();
    const threshold = onlineThreshold();

    const stale = db
      .prepare<[number], { device_id: string }>(
        "SELECT device_id FROM heartbeats WHERE online = 1 AND last_seen < ?",
      )
      .all(threshold);

    if (stale.length === 0) return [];

    const stmt = db.prepare(
      "UPDATE heartbeats SET online = 0 WHERE device_id = ?",
    );

    const offlineIds: string[] = [];

    db.transaction(() => {
      for (const row of stale) {
        stmt.run(row.device_id);
        offlineIds.push(row.device_id);
      }
    })();

    for (const deviceId of offlineIds) {
      log.warn({ deviceId }, "Device marked offline (heartbeat timeout)");
      eventBus.emit(EventTypes.DEVICE_OFFLINE, {
        deviceId,
        lastSeen: 0,
        timestamp: Date.now(),
      });
    }

    return offlineIds;
  }

  // ── Event Handlers ────────────────────────────────────────────────────────────

  private handleDiscovery(payload: DeviceRegisteredPayload): void {
    const { deviceId, roomId, type, ipAddress, timestamp } = payload;

    if (this.knownDeviceIds.has(deviceId)) {
      this.updateDevice(deviceId, { roomId, ipAddress });
    } else {
      this.registerDevice({
        deviceId,
        roomId,
        type: type ?? "relay",
        ipAddress,
      });
    }

    this.recordHeartbeat(deviceId, timestamp);
  }

  private handleHeartbeat(payload: DeviceHeartbeatPayload): void {
    const { deviceId, ipAddress, firmwareVersion, timestamp } = payload;

    if (!this.knownDeviceIds.has(deviceId)) {
      log.info({ deviceId }, "Unknown device sent heartbeat — auto-registering");
      this.registerDevice({ deviceId, ipAddress, firmwareVersion });
    } else if (ipAddress ?? firmwareVersion) {
      this.updateDevice(deviceId, { ipAddress, firmwareVersion });
    }

    this.recordHeartbeat(deviceId, timestamp);

    eventBus.emit(EventTypes.DEVICE_ONLINE, { deviceId, timestamp });
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function onlineThreshold(): number {
  return (
    Math.floor(Date.now() / 1000) -
    config.health.deviceOfflineThresholdSeconds
  );
}

function resolveStatus(
  hb: DbHeartbeat | null | undefined,
): { online: boolean; lastSeen: number | null } {
  if (!hb) return { online: false, lastSeen: null };
  const isOnline = hb.online === 1 && hb.last_seen >= onlineThreshold();
  return { online: isOnline, lastSeen: hb.last_seen };
}

function mapDevice(row: DbDevice): Device {
  return {
    id:              row.id,
    roomId:          row.room_id,
    type:            row.type,
    name:            row.name,
    ipAddress:       row.ip_address,
    firmwareVersion: row.firmware_version,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

function mapRoom(row: DbRoom): Room {
  return {
    id:         row.id,
    name:       row.name,
    propertyId: row.property_id,
    createdAt:  row.created_at,
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const deviceRegistry = new DeviceRegistry();
