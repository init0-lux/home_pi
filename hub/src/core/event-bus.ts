import { EventEmitter } from "events";
import { createLogger } from "../system/logger.js";

const log = createLogger("event-bus");

// ─── Event Type Definitions ───────────────────────────────────────────────────

export const EventTypes = {
  // Device lifecycle
  DEVICE_REGISTERED: "DEVICE_REGISTERED",
  DEVICE_UPDATED: "DEVICE_UPDATED",
  DEVICE_REMOVED: "DEVICE_REMOVED",

  // Device state
  DEVICE_STATE_CHANGED: "DEVICE_STATE_CHANGED",
  DEVICE_COMMAND_SENT: "DEVICE_COMMAND_SENT",

  // Connectivity
  DEVICE_ONLINE: "DEVICE_ONLINE",
  DEVICE_OFFLINE: "DEVICE_OFFLINE",
  DEVICE_HEARTBEAT: "DEVICE_HEARTBEAT",

  // MQTT
  MQTT_CONNECTED: "MQTT_CONNECTED",
  MQTT_DISCONNECTED: "MQTT_DISCONNECTED",
  MQTT_MESSAGE: "MQTT_MESSAGE",

  // Automation
  AUTOMATION_TRIGGERED: "AUTOMATION_TRIGGERED",
  SCHEDULE_FIRED: "SCHEDULE_FIRED",

  // PMS / Guest
  GUEST_CHECKIN: "GUEST_CHECKIN",
  GUEST_CHECKOUT: "GUEST_CHECKOUT",

  // System
  SYSTEM_READY: "SYSTEM_READY",
  SYSTEM_SHUTDOWN: "SYSTEM_SHUTDOWN",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ─── Payload Shapes Per Event ─────────────────────────────────────────────────

export interface DeviceRegisteredPayload {
  deviceId: string;
  roomId?: string;
  type: string;
  name?: string;
  ipAddress?: string;
  timestamp: number;
}

export interface DeviceUpdatedPayload {
  deviceId: string;
  changes: Partial<{
    roomId: string;
    name: string;
    ipAddress: string;
    firmwareVersion: string;
  }>;
  timestamp: number;
}

export interface DeviceRemovedPayload {
  deviceId: string;
  timestamp: number;
}

export interface DeviceStateChangedPayload {
  deviceId: string;
  channel: number;
  state: "ON" | "OFF";
  source: "mqtt" | "api" | "automation" | "scheduler";
  timestamp: number;
}

export interface DeviceCommandSentPayload {
  deviceId: string;
  channel: number;
  state: "ON" | "OFF";
  timestamp: number;
}

export interface DeviceOnlinePayload {
  deviceId: string;
  timestamp: number;
}

export interface DeviceOfflinePayload {
  deviceId: string;
  lastSeen: number;
  timestamp: number;
}

export interface DeviceHeartbeatPayload {
  deviceId: string;
  ipAddress?: string;
  firmwareVersion?: string;
  timestamp: number;
}

export interface MqttConnectedPayload {
  brokerUrl: string;
  timestamp: number;
}

export interface MqttDisconnectedPayload {
  reason?: string;
  timestamp: number;
}

export interface MqttMessagePayload {
  topic: string;
  message: string;
  timestamp: number;
}

export interface AutomationTriggeredPayload {
  automationId: string;
  trigger: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  timestamp: number;
}

export interface ScheduleFiredPayload {
  scheduleId: string;
  deviceId?: string;
  roomId?: string;
  action: Record<string, unknown>;
  timestamp: number;
}

export interface GuestCheckinPayload {
  guestId: string;
  roomId: string;
  checkinTime: number;
  timestamp: number;
}

export interface GuestCheckoutPayload {
  guestId: string;
  roomId: string;
  checkoutTime: number;
  timestamp: number;
}

export interface SystemReadyPayload {
  timestamp: number;
}

export interface SystemShutdownPayload {
  reason?: string;
  timestamp: number;
}

// ─── Typed Event Map ──────────────────────────────────────────────────────────

export interface EventPayloadMap {
  [EventTypes.DEVICE_REGISTERED]: DeviceRegisteredPayload;
  [EventTypes.DEVICE_UPDATED]: DeviceUpdatedPayload;
  [EventTypes.DEVICE_REMOVED]: DeviceRemovedPayload;
  [EventTypes.DEVICE_STATE_CHANGED]: DeviceStateChangedPayload;
  [EventTypes.DEVICE_COMMAND_SENT]: DeviceCommandSentPayload;
  [EventTypes.DEVICE_ONLINE]: DeviceOnlinePayload;
  [EventTypes.DEVICE_OFFLINE]: DeviceOfflinePayload;
  [EventTypes.DEVICE_HEARTBEAT]: DeviceHeartbeatPayload;
  [EventTypes.MQTT_CONNECTED]: MqttConnectedPayload;
  [EventTypes.MQTT_DISCONNECTED]: MqttDisconnectedPayload;
  [EventTypes.MQTT_MESSAGE]: MqttMessagePayload;
  [EventTypes.AUTOMATION_TRIGGERED]: AutomationTriggeredPayload;
  [EventTypes.SCHEDULE_FIRED]: ScheduleFiredPayload;
  [EventTypes.GUEST_CHECKIN]: GuestCheckinPayload;
  [EventTypes.GUEST_CHECKOUT]: GuestCheckoutPayload;
  [EventTypes.SYSTEM_READY]: SystemReadyPayload;
  [EventTypes.SYSTEM_SHUTDOWN]: SystemShutdownPayload;
}

// ─── Idempotency Cache ────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL_MS = 5_000; // 5 seconds

interface IdempotencyEntry {
  key: string;
  expiresAt: number;
}

// ─── Event Bus ────────────────────────────────────────────────────────────────

class EventBus {
  private emitter: EventEmitter;
  private idempotencyCache: Map<string, IdempotencyEntry>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.idempotencyCache = new Map();

    // Periodically purge expired idempotency entries
    this.cleanupTimer = setInterval(() => this.purgeIdempotencyCache(), 10_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref(); // Don't block process exit
    }
  }

  /**
   * Publish a typed event onto the bus.
   * Duplicate events (same deviceId + same second) are silently dropped.
   */
  emit<T extends EventType>(type: T, payload: EventPayloadMap[T]): void {
    const idempotencyKey = this.buildIdempotencyKey(
      type,
      payload as unknown as Record<string, unknown>,
    );
    if (idempotencyKey && this.isDuplicate(idempotencyKey)) {
      log.debug({ type, idempotencyKey }, "Duplicate event dropped");
      return;
    }

    if (idempotencyKey) {
      this.recordIdempotencyKey(idempotencyKey);
    }

    log.debug({ type, payload }, "Event emitted");
    this.emitter.emit(type, payload);
  }

  /**
   * Subscribe to a typed event.
   * Returns an unsubscribe function for easy cleanup.
   */
  on<T extends EventType>(
    type: T,
    handler: (payload: EventPayloadMap[T]) => void | Promise<void>,
  ): () => void {
    const wrappedHandler = async (payload: EventPayloadMap[T]) => {
      try {
        await handler(payload);
      } catch (err) {
        log.error({ err, type }, "Unhandled error in event handler");
      }
    };

    this.emitter.on(type, wrappedHandler);
    return () => this.emitter.off(type, wrappedHandler);
  }

  /**
   * Subscribe to an event exactly once.
   */
  once<T extends EventType>(
    type: T,
    handler: (payload: EventPayloadMap[T]) => void | Promise<void>,
  ): () => void {
    const wrappedHandler = async (payload: EventPayloadMap[T]) => {
      try {
        await handler(payload);
      } catch (err) {
        log.error({ err, type }, "Unhandled error in once event handler");
      }
    };

    this.emitter.once(type, wrappedHandler);
    return () => this.emitter.off(type, wrappedHandler);
  }

  /**
   * Remove all listeners for a specific event type.
   * Useful for clean teardown in tests.
   */
  off(type: EventType): void {
    this.emitter.removeAllListeners(type);
  }

  /**
   * Remove all listeners and stop the cleanup timer.
   * Call during graceful shutdown.
   */
  destroy(): void {
    this.emitter.removeAllListeners();
    this.idempotencyCache.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    log.info("Event bus destroyed");
  }

  listenerCount(type: EventType): number {
    return this.emitter.listenerCount(type);
  }

  // ── Idempotency Helpers ─────────────────────────────────────────────────────

  private buildIdempotencyKey(
    type: EventType,
    payload: Record<string, unknown>,
  ): string | null {
    // Only deduplicate device state change events to avoid relay flapping
    if (
      type === EventTypes.DEVICE_STATE_CHANGED ||
      type === EventTypes.DEVICE_HEARTBEAT
    ) {
      const deviceId = (payload as { deviceId?: string }).deviceId;
      const timestamp =
        (payload as { timestamp?: number }).timestamp ?? Date.now();
      if (deviceId) {
        // 1-second precision bucket
        const bucket = Math.floor(timestamp / 1000);
        return `${type}:${deviceId}:${bucket}`;
      }
    }
    return null;
  }

  private isDuplicate(key: string): boolean {
    const entry = this.idempotencyCache.get(key);
    if (!entry) return false;
    return entry.expiresAt > Date.now();
  }

  private recordIdempotencyKey(key: string): void {
    this.idempotencyCache.set(key, {
      key,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  private purgeIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.idempotencyCache) {
      if (entry.expiresAt <= now) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const eventBus = new EventBus();
