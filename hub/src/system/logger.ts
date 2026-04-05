import pino from "pino";
import { config } from "../config/index.js";

export const logger = pino({
  level: config.logging.level,
  transport:
    config.server.isDev
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  base: {
    service: "zapp-hub",
    property: config.hub.propertyId,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "authorization",
      "*.idToken",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = pino.Logger;

/**
 * Create a child logger scoped to a specific module.
 * Use this at the top of every module file so every log line
 * is tagged with its origin — invaluable when tailing live logs.
 *
 * @example
 * const log = createLogger("mqtt-gateway");
 * log.info("connected");
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
