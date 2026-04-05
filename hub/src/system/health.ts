import { createLogger } from "./logger.js";
import { deviceRegistry } from "../core/device-registry.js";
import { config } from "../config/index.js";

const log = createLogger("health-monitor");

// ─── Health Monitor ───────────────────────────────────────────────────────────

class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;

  // Check at half the offline threshold so we catch devices promptly,
  // but no more frequently than every 5 seconds.
  private readonly CHECK_INTERVAL_MS = Math.max(
    (config.health.deviceOfflineThresholdSeconds * 1_000) / 2,
    5_000,
  );

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) {
      log.warn("Health monitor already running");
      return;
    }

    log.info(
      {
        checkIntervalMs: this.CHECK_INTERVAL_MS,
        offlineThresholdSec: config.health.deviceOfflineThresholdSeconds,
      },
      "Health monitor started",
    );

    // Run an immediate check on startup so stale devices are caught right away.
    this.check();

    this.timer = setInterval(() => this.check(), this.CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Health monitor stopped");
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  // ── Check ─────────────────────────────────────────────────────────────────────

  /**
   * Scan all devices and mark any that have not sent a heartbeat within the
   * configured threshold as offline. Newly offline device IDs are returned.
   */
  private check(): void {
    try {
      const offlineIds = deviceRegistry.markStaleDevicesOffline();

      if (offlineIds.length > 0) {
        log.warn(
          { count: offlineIds.length, deviceIds: offlineIds },
          "Devices marked offline by health monitor",
        );
      } else {
        log.trace("Health check passed — no newly offline devices");
      }
    } catch (err) {
      log.error({ err }, "Health monitor check failed");
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  getStats(): {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    checkIntervalMs: number;
    offlineThresholdSec: number;
  } {
    const total  = deviceRegistry.getTotalCount();
    const online = deviceRegistry.getOnlineCount();

    return {
      totalDevices:        total,
      onlineDevices:       online,
      offlineDevices:      total - online,
      checkIntervalMs:     this.CHECK_INTERVAL_MS,
      offlineThresholdSec: config.health.deviceOfflineThresholdSeconds,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const healthMonitor = new HealthMonitor();
