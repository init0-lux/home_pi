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

function ok<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ ok: true, data });
}

type EventRow = {
  id: number;
  type: string;
  device_id: string | null;
  room_id: string | null;
  payload: string;
  timestamp: number;
};

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
  return {
    rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    external: Math.round((mem.external / 1024 / 1024) * 100) / 100,
  };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /health
   *
   * Lightweight liveness probe — no auth required.
   * Returns 200 if the process is alive.
   * Used by Docker HEALTHCHECK, load balancers, and systemd watchdog.
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
   * Readiness probe — checks that all subsystems are operational.
   * Returns 200 if ready, 503 if any critical subsystem is unhealthy.
   *
   * Checks:
   *   - Database connectivity
   *   - MQTT broker connectivity
   *   - Scheduler running
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
      if (mqttGateway.isConnected) {
        checks["mqtt"] = { status: "ok" };
      } else {
        checks["mqtt"] = {
          status: "error",
          detail: "MQTT broker not connected",
        };
        // MQTT connectivity is degraded but not fatal — hub still serves API
        // Don't set allOk = false here; just report the status
      }

      // ── Scheduler ─────────────────────────────────────────────────────────
      checks["scheduler"] = {
        status: scheduler.isRunning ? "ok" : "error",
        detail: scheduler.isRunning ? undefined : "Scheduler is not running",
      };

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
   * Full system status dashboard — requires auth.
   * Returns detailed metrics about all subsystems, device counts, memory, etc.
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

        const deviceCount =
          db
            .prepare<
              [],
              { count: number }
            >("SELECT COUNT(*) as count FROM devices")
            .get()?.count ?? 0;
        const roomCount =
          db
            .prepare<
              [],
              { count: number }
            >("SELECT COUNT(*) as count FROM rooms")
            .get()?.count ?? 0;
        const eventCount =
          db
            .prepare<
              [],
              { count: number }
            >("SELECT COUNT(*) as count FROM events")
            .get()?.count ?? 0;
        const userCount =
          db
            .prepare<
              [],
              { count: number }
            >("SELECT COUNT(*) as count FROM users")
            .get()?.count ?? 0;
        const guestCount =
          db
            .prepare<
              [],
              { count: number }
            >("SELECT COUNT(*) as count FROM guests WHERE active = 1")
            .get()?.count ?? 0;
        const scheduleCount =
          db
            .prepare<
              [],
              { count: number }
            >("SELECT COUNT(*) as count FROM schedules WHERE enabled = 1")
            .get()?.count ?? 0;

        // SQLite page_count and page_size pragmas for DB size estimate
        const pageCount =
          (db.pragma("page_count") as Array<{ page_count: number }>)[0]
            ?.page_count ?? 0;
        const pageSize =
          (db.pragma("page_size") as Array<{ page_size: number }>)[0]
            ?.page_size ?? 4096;
        const dbSizeBytes = pageCount * pageSize;

        dbStats = {
          connected: true,
          path: config.db.path,
          sizeKb: Math.round(dbSizeBytes / 1024),
          counts: {
            devices: deviceCount,
            rooms: roomCount,
            events: eventCount,
            users: userCount,
            activeGuests: guestCount,
            activeSchedules: scheduleCount,
          },
        };
      } catch (err) {
        dbStats = {
          connected: false,
          error: err instanceof Error ? err.message : "unknown error",
        };
      }

      // ── Device health ──────────────────────────────────────────────────────
      const totalDevices = deviceRegistry.getTotalCount();
      const onlineDevices = deviceRegistry.getOnlineCount();
      const cachedStates = stateManager.cacheSize;

      // ── MQTT status ────────────────────────────────────────────────────────
      const mqttStatus = {
        connected: mqttGateway.isConnected,
        brokerUrl: config.mqtt.brokerUrl,
        clientId: config.mqtt.clientId,
        qos: config.mqtt.qos,
      };

      // ── Scheduler status ───────────────────────────────────────────────────
      const schedulerStatus = {
        running: scheduler.isRunning,
        precision: "1s",
      };

      // ── Hub identity ───────────────────────────────────────────────────────
      const hubInfo = {
        name: config.hub.name,
        propertyId: config.hub.propertyId,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        env: config.server.nodeEnv,
      };

      return ok(reply, {
        hub: hubInfo,
        uptime: {
          seconds: uptimeSec,
          formatted: formatUptime(uptimeSec),
          startedAt: new Date(startTime).toISOString(),
        },
        memory,
        database: dbStats,
        mqtt: mqttStatus,
        scheduler: schedulerStatus,
        devices: {
          total: totalDevices,
          online: onlineDevices,
          offline: totalDevices - onlineDevices,
          cachedStates,
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
   * Quick device health overview — online/offline counts per room.
   * Useful for the dashboard's top-level status indicator.
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

      // Devices not yet assigned to any room
      const unassigned = allDevices.filter((d) => !d.roomId);

      return ok(reply, {
        summary: {
          total: allDevices.length,
          online: allDevices.filter((d) => d.online).length,
          offline: allDevices.filter((d) => !d.online).length,
        },
        byRoom,
        unassigned: unassigned.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          online: d.online,
          lastSeen: d.lastSeen,
        })),
      });
    },
  );

  /**
   * GET /health/events
   *
   * Recent system events (last 200). Useful for debugging.
   */
  fastify.get(
    "/health/events",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Simple inline query param parsing
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

      const rows = type
        ? db.prepare(sql).all(type, limit)
        : db.prepare(sql).all(limit);

      const events = (rows as EventRow[]).map((e) => ({
        id: e.id,
        type: e.type,
        deviceId: e.device_id,
        roomId: e.room_id,
        payload: (() => {
          try {
            return JSON.parse(e.payload);
          } catch {
            return e.payload;
          }
        })(),
        timestamp: e.timestamp,
        iso: new Date(e.timestamp * 1000).toISOString(),
      }));

      return ok(reply, { events, count: events.length, limit });
    },
  );
}
