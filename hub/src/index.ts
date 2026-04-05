import 'dotenv/config';
import { initDb, closeDb } from './db/index.js';
import { createLogger } from './system/logger.js';
import { eventBus, EventTypes } from './core/event-bus.js';
import { mqttGateway } from './core/mqtt-gateway.js';
import { stateManager } from './core/state-manager.js';
import { deviceRegistry } from './core/device-registry.js';
import { scheduler } from './core/scheduler.js';
import { automationEngine } from './core/automation-engine.js';
import { healthMonitor } from './system/health.js';
import { eventLogger } from './system/event-logger.js';
import { buildServer, startServer } from './api/index.js';
import { config } from './config/index.js';

const log = createLogger('main');

// ─── Boot Sequence ────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  log.info(
    {
      hub:     config.hub.name,
      property: config.hub.propertyId,
      env:     config.server.nodeEnv,
      port:    config.server.port,
    },
    '🔧 Zapp Hub starting up...',
  );

  // ── 1. Database ─────────────────────────────────────────────────────────────
  log.info('Initializing database...');
  initDb();

  // ── 2. Event Logger ─────────────────────────────────────────────────────────
  // Must be initialized before any events are emitted so nothing is missed.
  log.info('Initializing event logger...');
  eventLogger.init();

  // ── 3. State Manager ────────────────────────────────────────────────────────
  // Loads persisted device states into memory cache.
  log.info('Initializing state manager...');
  stateManager.init();

  // ── 4. Device Registry ──────────────────────────────────────────────────────
  // Loads known devices and subscribes to MQTT discovery events.
  log.info('Initializing device registry...');
  deviceRegistry.init();

  // ── 5. Automation Engine ────────────────────────────────────────────────────
  // Subscribes to schedule / guest / device-state events and executes rules.
  log.info('Initializing automation engine...');
  automationEngine.init();

  // ── 6. Scheduler ────────────────────────────────────────────────────────────
  // Starts the 1-second tick loop for time-based automations.
  log.info('Starting scheduler...');
  scheduler.start();

  // ── 7. Health Monitor ───────────────────────────────────────────────────────
  // Periodically marks stale devices as offline.
  log.info('Starting health monitor...');
  healthMonitor.start();

  // ── 8. MQTT Gateway ─────────────────────────────────────────────────────────
  // Connects to Mosquitto and subscribes to all device topics.
  log.info('Connecting to MQTT broker...');
  mqttGateway.connect();

  // ── 9. HTTP Server ──────────────────────────────────────────────────────────
  log.info('Building HTTP server...');
  const fastify = await buildServer();
  await startServer(fastify);

  // ── 10. Announce system ready ────────────────────────────────────────────────
  eventBus.emit(EventTypes.SYSTEM_READY, { timestamp: Date.now() });

  log.info(
    {
      hub:        config.hub.name,
      propertyId: config.hub.propertyId,
      apiUrl:     `http://${config.server.host}:${config.server.port}`,
      mqttUrl:    config.mqtt.brokerUrl,
      dbPath:     config.db.path,
      mcpEnabled: config.mcp.enabled,
    },
    '✅ Zapp Hub is fully operational',
  );

  // ── Graceful Shutdown ────────────────────────────────────────────────────────
  const shutdown = (signal: string) => async () => {
    log.info({ signal }, 'Shutdown signal received — starting graceful shutdown...');

    eventBus.emit(EventTypes.SYSTEM_SHUTDOWN, {
      reason: `Signal: ${signal}`,
      timestamp: Date.now(),
    });

    try {
      // Stop accepting new HTTP connections
      log.info('Closing HTTP server...');
      await fastify.close();

      // Stop background workers
      log.info('Stopping scheduler...');
      scheduler.stop();

      log.info('Stopping health monitor...');
      healthMonitor.stop();

      // Disconnect MQTT (publishes hub offline LWT)
      log.info('Disconnecting from MQTT broker...');
      await mqttGateway.disconnect();

      // Tear down automation engine timers
      log.info('Destroying automation engine...');
      automationEngine.destroy();

      // Stop event logger subscriptions
      log.info('Destroying event logger...');
      eventLogger.destroy();

      // Destroy event bus last
      log.info('Destroying event bus...');
      eventBus.destroy();

      // Close DB connection
      log.info('Closing database...');
      closeDb();

      log.info('✅ Graceful shutdown complete. Goodbye.');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Error during graceful shutdown — forcing exit');
      process.exit(1);
    }
  };

  process.once('SIGTERM', shutdown('SIGTERM'));
  process.once('SIGINT',  shutdown('SIGINT'));
  process.once('SIGHUP',  shutdown('SIGHUP'));

  // ── Unhandled Rejections ─────────────────────────────────────────────────────
  process.on('unhandledRejection', (reason, promise) => {
    log.error({ reason, promise }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception — forcing exit');
    process.exit(1);
  });
}

// ─── Launch ───────────────────────────────────────────────────────────────────

boot().catch((err) => {
  // Use console.error as a last resort if logger itself fails to init
  console.error('Fatal error during boot:', err);
  process.exit(1);
});
