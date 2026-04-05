import { getDb } from "../db/index.js";
import { createLogger } from "./logger.js";
import { eventBus, EventTypes } from "../core/event-bus.js";

const log = createLogger("event-logger");

// ─── Event Logger ─────────────────────────────────────────────────────────────
//
// Passive observer that subscribes to the internal event bus and persists
// every important event to the SQLite `events` table. This gives us a full
// audit trail without coupling any business-logic module to the DB directly.
//
// Design principles:
//   • Never mutates state or emits events of its own.
//   • Swallows DB errors silently — logging must never crash the main flow.
//   • Redacts sensitive fields before storing.
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
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
 * Return a shallow copy of a payload object with sensitive keys redacted
 * and the `timestamp` key removed (it is stored as a dedicated column).
 */
function sanitize(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "timestamp") continue;
    out[key] = SENSITIVE_KEYS.has(key) ? REDACTED : value;
  }
  return out;
}

class EventLogger {
  private readonly unsubscribers: Array<() => void> = [];

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  init(): void {
    this.unsubscribers.push(
      // ── Device lifecycle ─────────────────────────────────────────────────────
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

      // ── Device state ─────────────────────────────────────────────────────────
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

      // ── Connectivity ─────────────────────────────────────────────────────────
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

      // ── Automation & scheduling ───────────────────────────────────────────────
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

      // ── PMS / Guests ─────────────────────────────────────────────────────────
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

      // ── MQTT connectivity ─────────────────────────────────────────────────────
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

      // ── System lifecycle ──────────────────────────────────────────────────────
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
    );

    log.info(
      { subscriptions: this.unsubscribers.length },
      "Event logger initialized",
    );
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    log.info("Event logger destroyed");
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  /**
   * Write a single event row to the `events` table.
   *
   * Errors are swallowed here intentionally — a logging failure must never
   * interrupt the main event flow.
   */
  private persist(
    type: string,
    deviceId: string | null | undefined,
    roomId: string | null | undefined,
    payload: Record<string, unknown>,
  ): void {
    try {
      const db = getDb();

      // Derive the epoch timestamp. Payloads may carry it in milliseconds
      // (Date.now()) or seconds (unixepoch). Values > 1e12 are treated as ms.
      const rawTs = payload["timestamp"] as number | undefined;
      let timestampSec: number;
      if (rawTs !== undefined) {
        timestampSec = rawTs > 1e12 ? Math.floor(rawTs / 1000) : rawTs;
      } else {
        timestampSec = Math.floor(Date.now() / 1000);
      }

      const safePayload = sanitize(payload);

      db.prepare<[string, string | null, string | null, string, number]>(
        `INSERT INTO events (type, device_id, room_id, payload, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        type,
        deviceId ?? null,
        roomId ?? null,
        JSON.stringify(safePayload),
        timestampSec,
      );

      log.trace({ type, deviceId, roomId, timestampSec }, "Event persisted");
    } catch (err) {
      log.error(
        { err, type, deviceId, roomId },
        "Failed to persist event to DB",
      );
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const eventLogger = new EventLogger();
