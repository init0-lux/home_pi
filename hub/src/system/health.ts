import { createLogger } from './logger.js';
import { deviceRegistry } from '../core/device-registry.js';
import { config } from '../config/index.js';

const log = createLogger('health-monitor');

// ─── Health Monitor ───────────────────────────────────────────────────────────

class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS: number;

  constructor() {
    // Check at half the offline threshold to catch devices promptly
    const thresholdMs = config.health.deviceOfflineThresholdSeconds * 1000;
    this.CHECK_INTERVAL_MS = Math.max(thresholdMs / 2, 5_000); // at least 5s
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) {
      log.warn('Health monitor already running');
      return;
    }

    log.info(
      { checkIntervalMs: this.CHECK_INTERVAL_MS, thresholdSec: config.health.deviceOfflineThresholdSeconds },
      'Health monitor started',
    );

    this.timer = setInterval(() => {
      this.check();
    }, this.CHECK_INTERVAL_MS);

    // Don't hold the event loop open
    if (this.timer.unref) {
      this.timer.unref();
    }

    // Run an immediate check on startup
    this.check();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('Health monitor stopped');
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  // ── Check ───────────────────────────────────────────────────────────────────

  /**
   * Scan all devices and mark those that haven't sent a heartbeat
   * within the configured threshold as offline.
   */
  private check(): void {
    try {
      const offlineDeviceIds = deviceRegistry.markStaleDevicesOffline();

      if (offlineDeviceIds.length > 0) {
        log.warn(
          { count: offlineDeviceIds.length, deviceIds: offlineDeviceIds },
          'Devices marked offline by health monitor',
        );
      } else {
        log.trace('Health check passed — no newly offline devices');
      }
    } catch (err) {
      log.error({ err }, 'Health monitor check failed');
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

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
