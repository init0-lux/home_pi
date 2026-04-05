import "dotenv/config";
import { Bonjour } from "bonjour-service";
import { initDb, closeDb } from "./db/index.js";
import { createLogger } from "./system/logger.js";
import { eventBus, EventTypes } from "./core/event-bus.js";
import { mqttGateway } from "./core/mqtt-gateway.js";
import { stateManager } from "./core/state-manager.js";
import { deviceRegistry } from "./core/device-registry.js";
import { scheduler } from "./core/scheduler.js";
import { automationEngine } from "./core/automation-engine.js";
import { healthMonitor } from "./system/health.js";
import { eventLogger } from "./system/event-logger.js";
import { buildServer, startServer } from "./api/index.js";
import { config } from "./config/index.js";

const log = createLogger("main");

// ─── Boot Sequence ────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  log.info(
    {
      hub: config.hub.name,
      property: config.hub.propertyId,
      env: config.server.nodeEnv,
      port: config.server.port,
    },
    "🔧 Zapp Hub starting up...",
  );

  // ── 1. Database ─────────────────────────────────────────────────────────────
  // Must be first — everything else reads / writes the DB.
  log.info("Initializing database...");
  initDb();

  // ── 2. Event Logger ──────────────────────────────────────────────────────────
  // Initialize before any events are emitted so nothing is missed.
  log.info("Initializing event logger...");
  eventLogger.init();

  // ── 3. State Manager ─────────────────────────────────────────────────────────
  // Loads persisted device states into the in-memory write-through cache.
  log.info("Initializing state manager...");
  stateManager.init();

  // ── 4. Device Registry ───────────────────────────────────────────────────────
  // Loads known devices, subscribes to MQTT discovery / heartbeat events.
  log.info("Initializing device registry...");
  deviceRegistry.init();

  // ── 5. Automation Engine ─────────────────────────────────────────────────────
  // Subscribes to schedule-fired, guest, and device-state events.
  log.info("Initializing automation engine...");
  automationEngine.init();

  // ── 6. Scheduler ─────────────────────────────────────────────────────────────
  // Starts the 1-second tick loop for time-based automations.
  log.info("Starting scheduler...");
  scheduler.start();

  // ── 7. Health Monitor ────────────────────────────────────────────────────────
  // Periodically marks devices offline when heartbeats stop.
  log.info("Starting health monitor...");
  healthMonitor.start();

  // ── 8. MQTT Gateway ──────────────────────────────────────────────────────────
  // Connects to Mosquitto. Subscribes to all device topics.
  // Placed after all event subscribers are registered so no messages are lost.
  log.info("Connecting to MQTT broker...");
  mqttGateway.connect();

  // ── 9. HTTP Server ───────────────────────────────────────────────────────────
  log.info("Building HTTP server...");
  const fastify = await buildServer();
  await startServer(fastify);

  // ── 10. mDNS Advertisement ────────────────────────────────────────────────────
  // Advertise the hub as "zapp" on the local network so devices can discover it
  // at http://zapp.local:<port> without needing to know the IP address.
  let bonjourInstance: Bonjour | null = null;
  try {
    bonjourInstance = new Bonjour();
    bonjourInstance.publish({
      name: config.hub.name,
      type: "http",
      port: config.server.port,
      txt: {
        path: "/",
        hub: config.hub.propertyId,
      },
    });
    log.info(
      { name: config.hub.name, port: config.server.port },
      "📡 mDNS service published — hub accessible at http://zapp.local:" +
        config.server.port,
    );
  } catch (err) {
    log.warn(
      { err },
      "mDNS advertisement failed (non-fatal) — hub still accessible by IP",
    );
  }

  // ── 11. Announce ready ────────────────────────────────────────────────────────
  eventBus.emit(EventTypes.SYSTEM_READY, { timestamp: Date.now() });

  log.info(
    {
      apiUrl: `http://${config.server.host}:${config.server.port}`,
      mdns: `http://zapp.local:${config.server.port}`,
      mqttUrl: config.mqtt.brokerUrl,
      dbPath: config.db.path,
      mcpEnabled: config.mcp.enabled,
      skipAuth: process.env.SKIP_AUTH === "true",
    },
    "✅ Zapp Hub is fully operational",
  );

  // ── Graceful Shutdown ────────────────────────────────────────────────────────

  // ── Graceful Shutdown ────────────────────────────────────────────────────────

  const shutdown = (signal: string) => async () => {
    log.info(
      { signal },
      "Shutdown signal received — gracefully shutting down...",
    );

    eventBus.emit(EventTypes.SYSTEM_SHUTDOWN, {
      reason: `Signal: ${signal}`,
      timestamp: Date.now(),
    });

    try {
      // 1. Stop accepting new HTTP connections.
      log.info("Closing HTTP server...");
      await fastify.close();

      // 2. Stop background workers.
      log.info("Stopping scheduler...");
      scheduler.stop();

      log.info("Stopping health monitor...");
      healthMonitor.stop();

      // 3. Disconnect MQTT (publishes hub offline LWT before closing).
      log.info("Disconnecting from MQTT broker...");
      await mqttGateway.disconnect();

      // 4. Tear down automation engine (cancels pending delayed actions).
      log.info("Destroying automation engine...");
      automationEngine.destroy();

      // 5. Remove event logger subscriptions.
      log.info("Destroying event logger...");
      eventLogger.destroy();

      // 6. Destroy event bus last (removes all remaining listeners).
      log.info("Destroying event bus...");
      eventBus.destroy();

      // 7. Stop mDNS advertisement.
      if (bonjourInstance) {
        log.info("Stopping mDNS advertisement...");
        bonjourInstance.unpublishAll(() => {
          bonjourInstance?.destroy();
        });
      }

      // 8. Close the SQLite connection.
      log.info("Closing database...");
      closeDb();

      log.info("✅ Graceful shutdown complete. Goodbye.");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "Error during graceful shutdown — forcing exit");
      process.exit(1);
    }
  };

  process.once("SIGTERM", shutdown("SIGTERM"));
  process.once("SIGINT", shutdown("SIGINT"));
  process.once("SIGHUP", shutdown("SIGHUP"));

  // ── Unhandled Rejection / Exception Handlers ────────────────────────────────

  process.on("unhandledRejection", (reason, promise) => {
    log.error({ reason, promise }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "Uncaught exception — forcing exit");
    process.exit(1);
  });
}

// ─── Launch ───────────────────────────────────────────────────────────────────

boot().catch((err: unknown) => {
  // Use console.error as last resort if the logger itself fails to initialise.
  console.error("Fatal error during boot:", err);
  process.exit(1);
});
