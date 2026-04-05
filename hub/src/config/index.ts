import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Environment variable ${key} must be an integer, got: ${value}`,
    );
  }
  return parsed;
}

function optionalBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

export const config = {
  // ── Server ──────────────────────────────────────────────────────────────────
  server: {
    nodeEnv: optional("NODE_ENV", "development"),
    port: optionalInt("PORT", 3000),
    host: optional("HOST", "0.0.0.0"),
    get isDev() {
      return this.nodeEnv === "development";
    },
    get isProd() {
      return this.nodeEnv === "production";
    },
  },

  // ── MQTT ────────────────────────────────────────────────────────────────────
  mqtt: {
    host: optional("MQTT_HOST", "localhost"),
    port: optionalInt("MQTT_PORT", 1883),
    username: optional("MQTT_USERNAME", ""),
    password: optional("MQTT_PASSWORD", ""),
    clientId: optional("MQTT_CLIENT_ID", `zapp-hub-${process.pid}`),
    qos: optionalInt("MQTT_QOS", 1) as 0 | 1 | 2,
    get brokerUrl() {
      return `mqtt://${this.host}:${this.port}`;
    },
  },

  // ── Database ─────────────────────────────────────────────────────────────────
  db: {
    path: optional("DB_PATH", "./data/zapp.db"),
  },

  // ── Authentication ───────────────────────────────────────────────────────────
  auth: {
    googleClientId: optional("GOOGLE_CLIENT_ID", ""),
    jwtSecret: optional("JWT_SECRET", "dev-secret-change-in-production"),
    jwtExpiry: optional("JWT_EXPIRY", "7d"),
  },

  // ── Health Monitoring ────────────────────────────────────────────────────────
  health: {
    deviceOfflineThresholdSeconds: optionalInt(
      "DEVICE_OFFLINE_THRESHOLD_SECONDS",
      30,
    ),
    deviceHeartbeatIntervalSeconds: optionalInt(
      "DEVICE_HEARTBEAT_INTERVAL_SECONDS",
      10,
    ),
  },

  // ── OTA ─────────────────────────────────────────────────────────────────────
  ota: {
    firmwareDir: optional("OTA_FIRMWARE_DIR", "./firmware"),
  },

  // ── Logging ─────────────────────────────────────────────────────────────────
  logging: {
    level: optional("LOG_LEVEL", "info") as
      | "trace"
      | "debug"
      | "info"
      | "warn"
      | "error"
      | "fatal",
  },

  // ── MCP ─────────────────────────────────────────────────────────────────────
  mcp: {
    enabled: optionalBool("MCP_ENABLED", true),
    apiKey: optional("MCP_API_KEY", ""),
  },

  // ── CORS ────────────────────────────────────────────────────────────────────
  cors: {
    origins: optional("CORS_ORIGINS", "http://localhost:3001")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // ── Property / Hub Identity ──────────────────────────────────────────────────
  hub: {
    propertyId: optional("PROPERTY_ID", "default-property"),
    name: optional("HUB_NAME", "Zapp Hub"),
  },
} as const;

export type Config = typeof config;
