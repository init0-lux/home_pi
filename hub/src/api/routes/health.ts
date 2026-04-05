import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../system/logger.js";
import { mqttGateway } from "../../core/mqtt-gateway.js";
import { deviceRegistry } from "../../core/device-registry.js";
import { stateManager } from "../../core/state-manager.js";
import { scheduler } from "../../core/scheduler.js";
import { config } from "../../config/index.js";
import { requireAuth } from "../middleware/auth.js";

const log = createLogger("api:health");

const startTime = Date.now();

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EventRow = {
  id: number;
  type: string;
  device_id: string | null;
  room_id: string | null;
  payload: string;
  timestamp: number;
};

function ok<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ ok: true, data });
}

function uptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function memoryUsageMb(): {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
} {
  const mem = process.memoryUsage();
  const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
  return {
    rss: mb(mem.rss),
    heapUsed: mb(mem.heapUsed),
    heapTotal: mb(mem.heapTotal),
    external: mb(mem.external),
  };
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /health
   *
   * Liveness probe — no auth required.
   * Returns 200 if the Node.js process is alive.
   * Used by Docker HEALTHCHECK, systemd watchdog, and load balancers.
   */
  fastify.get(
    "/health",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: uptimeSeconds(),
      });
    },
  );

  /**
   * GET /health/ready
   *
   * Readiness probe — no auth required.
   * Checks that all critical subsystems are operational:
   *   • SQLite database (can execute a query)
   *   • MQTT broker (connected)
   *   • Scheduler (tick loop running)
   *
   * Returns 200 when ready, 503 when any critical subsystem is down.
   * MQTT degradation is reported but does NOT cause a 503 — the hub can
   * still serve the API even when the broker is temporarily unreachable.
   */
  fastify.get(
    "/health/ready",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const checks: Record<
        string,
        { status: "ok" | "error"; detail?: string }
      > = {};
      let allOk = true;

      // ── Database ───────────────────────────────────────────────────────────
      try {
        const db = getDb();
        db.prepare("SELECT 1").get();
        checks["database"] = { status: "ok" };
      } catch (err) {
        checks["database"] = {
          status: "error",
          detail: err instanceof Error ? err.message : "unknown error",
        };
        allOk = false;
      }

      // ── MQTT ──────────────────────────────────────────────────────────────
      // Degraded but not fatal — the hub keeps serving the API.
      checks["mqtt"] = mqttGateway.isConnected
        ? { status: "ok" }
        : { status: "error", detail: "MQTT broker not connected" };

      // ── Scheduler ─────────────────────────────────────────────────────────
      checks["scheduler"] = scheduler.isRunning
        ? { status: "ok" }
        : { status: "error", detail: "Scheduler is not running" };

      if (!scheduler.isRunning) allOk = false;

      const statusCode = allOk ? 200 : 503;

      log.debug({ checks, allOk }, "Readiness check completed");

      return reply.status(statusCode).send({
        status: allOk ? "ready" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: uptimeSeconds(),
        checks,
      });
    },
  );

  /**
   * GET /health/status
   *
   * Full system status — requires auth.
   * Returns detailed metrics: memory, uptime, DB stats, device counts,
   * MQTT config, scheduler state, and hub identity.
   *
   * Used by the dashboard's health panel and admin debugging tools.
   */
  fastify.get(
    "/health/status",
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const uptimeSec = uptimeSeconds();
      const memory = memoryUsageMb();

      // ── Database stats ─────────────────────────────────────────────────────
      let dbStats: Record<string, unknown> = {};
      try {
        const db = getDb();

        const count = (sql: string): number =>
          db.prepare<[], { count: number }>(sql).get()?.count ?? 0;

        const pageCount =
          (db.pragma("page_count") as Array<{ page_count: number }>)[0]
            ?.page_count ?? 0;
        const pageSize =
          (db.pragma("page_size") as Array<{ page_size: number }>)[0]
            ?.page_size ?? 4096;

        dbStats = {
          connected: true,
          path: config.db.path,
          sizeKb: Math.round((pageCount * pageSize) / 1024),
          counts: {
            devices: count("SELECT COUNT(*) as count FROM devices"),
            rooms: count("SELECT COUNT(*) as count FROM rooms"),
            events: count("SELECT COUNT(*) as count FROM events"),
            users: count("SELECT COUNT(*) as count FROM users"),
            activeGuests: count(
              "SELECT COUNT(*) as count FROM guests WHERE active = 1",
            ),
            activeSchedules: count(
              "SELECT COUNT(*) as count FROM schedules WHERE enabled = 1",
            ),
          },
        };
      } catch (err) {
        dbStats = {
          connected: false,
          error: err instanceof Error ? err.message : "unknown error",
        };
      }

      const totalDevices = deviceRegistry.getTotalCount();
      const onlineDevices = deviceRegistry.getOnlineCount();

      return ok(reply, {
        hub: {
          name: config.hub.name,
          propertyId: config.hub.propertyId,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          env: config.server.nodeEnv,
        },
        uptime: {
          seconds: uptimeSec,
          formatted: formatUptime(uptimeSec),
          startedAt: new Date(startTime).toISOString(),
        },
        memory,
        database: dbStats,
        mqtt: {
          connected: mqttGateway.isConnected,
          brokerUrl: config.mqtt.brokerUrl,
          clientId: config.mqtt.clientId,
          qos: config.mqtt.qos,
        },
        scheduler: {
          running: scheduler.isRunning,
          precision: "1s",
        },
        devices: {
          total: totalDevices,
          online: onlineDevices,
          offline: totalDevices - onlineDevices,
          cachedStates: stateManager.cacheSize,
          offlineThresholdSeconds: config.health.deviceOfflineThresholdSeconds,
        },
        mcp: {
          enabled: config.mcp.enabled,
        },
      });
    },
  );

  /**
   * GET /health/devices
   *
   * Quick device health overview — requires auth.
   * Returns online/offline counts per room plus a list of unassigned devices.
   * Designed for the dashboard's top-level status indicator dot.
   */
  fastify.get(
    "/health/devices",
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const allDevices = deviceRegistry.listDevicesWithStatus();
      const rooms = deviceRegistry.listRooms();

      const byRoom = rooms.map((room) => {
        const roomDevices = allDevices.filter((d) => d.roomId === room.id);
        return {
          roomId: room.id,
          roomName: room.name,
          total: roomDevices.length,
          online: roomDevices.filter((d) => d.online).length,
          offline: roomDevices.filter((d) => !d.online).length,
          devices: roomDevices.map((d) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            online: d.online,
            lastSeen: d.lastSeen,
          })),
        };
      });

      const unassigned = allDevices
        .filter((d) => !d.roomId)
        .map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          online: d.online,
          lastSeen: d.lastSeen,
        }));

      return ok(reply, {
        summary: {
          total: allDevices.length,
          online: allDevices.filter((d) => d.online).length,
          offline: allDevices.filter((d) => !d.online).length,
        },
        byRoom,
        unassigned,
      });
    },
  );

  /**
   * GET /health/events
   *
   * Recent system events from the audit log — requires auth.
   * Supports filtering by event type and controlling the result limit.
   *
   * Query params:
   *   limit  — max number of events to return (default 100, max 500)
   *   type   — filter by event type (e.g. DEVICE_STATE_CHANGED)
   *
   * Useful for debugging and live monitoring.
   */
  fastify.get(
    "/health/events",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string>;
      const limit = Math.min(parseInt(query["limit"] ?? "100", 10) || 100, 500);
      const type = query["type"];

      const db = getDb();

      const sql = type
        ? `SELECT id, type, device_id, room_id, payload, timestamp
           FROM events WHERE type = ?
           ORDER BY timestamp DESC LIMIT ?`
        : `SELECT id, type, device_id, room_id, payload, timestamp
           FROM events
           ORDER BY timestamp DESC LIMIT ?`;

      const rows = (
        type ? db.prepare(sql).all(type, limit) : db.prepare(sql).all(limit)
      ) as EventRow[];

      const events = rows.map((e) => ({
        id: e.id,
        type: e.type,
        deviceId: e.device_id,
        roomId: e.room_id,
        payload: parsePayload(e.payload),
        timestamp: e.timestamp,
        iso: new Date(e.timestamp * 1000).toISOString(),
      }));

      return ok(reply, { events, count: events.length, limit });
    },
  );
}
