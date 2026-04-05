import { getDb } from "../db/index.js";
import { createLogger } from "./logger.js";
import { eventBus, EventTypes } from "../core/event-bus.js";

const log = createLogger("event-logger");

// ─── Event Logger ─────────────────────────────────────────────────────────────
//
// Subscribes to the internal event bus and persists important events to the
// SQLite `events` table for a full audit trail.
//
// This is intentionally a passive observer — it never mutates state or
// publishes events of its own.
// ─────────────────────────────────────────────────────────────────────────────

class EventLogger {
  private unsubscribers: Array<() => void> = [];

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  init(): void {
    this.unsubscribers = [
      // Device lifecycle
      eventBus.on(EventTypes.DEVICE_REGISTERED, (p) =>
        this.persist(
          EventTypes.DEVICE_REGISTERED,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.DEVICE_UPDATED, (p) =>
        this.persist(
          EventTypes.DEVICE_UPDATED,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.DEVICE_REMOVED, (p) =>
        this.persist(
          EventTypes.DEVICE_REMOVED,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),

      // Device state
      eventBus.on(EventTypes.DEVICE_STATE_CHANGED, (p) =>
        this.persist(
          EventTypes.DEVICE_STATE_CHANGED,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.DEVICE_COMMAND_SENT, (p) =>
        this.persist(
          EventTypes.DEVICE_COMMAND_SENT,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),

      // Connectivity
      eventBus.on(EventTypes.DEVICE_ONLINE, (p) =>
        this.persist(
          EventTypes.DEVICE_ONLINE,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.DEVICE_OFFLINE, (p) =>
        this.persist(
          EventTypes.DEVICE_OFFLINE,
          p.deviceId,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),

      // Automation & scheduling
      eventBus.on(EventTypes.AUTOMATION_TRIGGERED, (p) =>
        this.persist(
          EventTypes.AUTOMATION_TRIGGERED,
          undefined,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.SCHEDULE_FIRED, (p) =>
        this.persist(
          EventTypes.SCHEDULE_FIRED,
          p.deviceId,
          p.roomId,
          p as unknown as Record<string, unknown>,
        ),
      ),

      // PMS / guests
      eventBus.on(EventTypes.GUEST_CHECKIN, (p) =>
        this.persist(
          EventTypes.GUEST_CHECKIN,
          undefined,
          p.roomId,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.GUEST_CHECKOUT, (p) =>
        this.persist(
          EventTypes.GUEST_CHECKOUT,
          undefined,
          p.roomId,
          p as unknown as Record<string, unknown>,
        ),
      ),

      // MQTT connectivity (hub-level events worth auditing)
      eventBus.on(EventTypes.MQTT_CONNECTED, (p) =>
        this.persist(
          EventTypes.MQTT_CONNECTED,
          undefined,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.MQTT_DISCONNECTED, (p) =>
        this.persist(
          EventTypes.MQTT_DISCONNECTED,
          undefined,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),

      // System lifecycle
      eventBus.on(EventTypes.SYSTEM_READY, (p) =>
        this.persist(
          EventTypes.SYSTEM_READY,
          undefined,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
      eventBus.on(EventTypes.SYSTEM_SHUTDOWN, (p) =>
        this.persist(
          EventTypes.SYSTEM_SHUTDOWN,
          undefined,
          undefined,
          p as unknown as Record<string, unknown>,
        ),
      ),
    ];

    log.info(
      { subscriptions: this.unsubscribers.length },
      "Event logger initialized",
    );
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    log.info("Event logger destroyed");
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  /**
   * Write a single event row to the `events` table.
   *
   * We swallow any DB errors here so that a logging failure never
   * crashes the main event flow.
   */
  private persist(
    type: string,
    deviceId: string | null | undefined,
    roomId: string | null | undefined,
    payload: Record<string, unknown>,
  ): void {
    try {
      const db = getDb();

      // Derive timestamp from payload if available, else use wall clock.
      // Payload timestamps may be in ms (Date.now()) or seconds (epoch).
      let timestampSec: number;
      const rawTs = payload["timestamp"] as number | undefined;
      if (rawTs !== undefined) {
        // If the value looks like milliseconds (> year 3000 in seconds),
        // convert to seconds.
        timestampSec = rawTs > 1e12 ? Math.floor(rawTs / 1000) : rawTs;
      } else {
        timestampSec = Math.floor(Date.now() / 1000);
      }

      // Strip the timestamp from the stored payload to avoid duplication,
      // and redact any sensitive fields.
      const safePayload = sanitizePayload(payload);

      db.prepare<[string, string | null, string | null, string, number]>(
        `
        INSERT INTO events (type, device_id, room_id, payload, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        type,
        deviceId ?? null,
        roomId ?? null,
        JSON.stringify(safePayload),
        timestampSec,
      );

      log.trace({ type, deviceId, roomId, timestampSec }, "Event persisted");
    } catch (err) {
      // Log the failure but never re-throw — event logging is best-effort.
      log.error(
        { err, type, deviceId, roomId },
        "Failed to persist event to DB",
      );
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REDACTED_KEYS = new Set([
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "idToken",
  "id_token",
]);

/**
 * Return a shallow copy of the payload with sensitive keys redacted.
 * Also removes the `timestamp` key since it is stored as a dedicated column.
 */
function sanitizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (key === "timestamp") continue; // stored as a column
    if (REDACTED_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const eventLogger = new EventLogger();
