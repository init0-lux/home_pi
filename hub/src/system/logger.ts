import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logging.level,
  transport:
    config.server.isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'zapp-hub',
    property: config.hub.propertyId,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: ['*.password', '*.token', '*.secret', '*.apiKey', 'authorization'],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;

/**
 * Create a child logger with a specific module context.
 * Use this in every module so logs are tagged with their origin.
 *
 * @example
 * const log = createLogger('mqtt-gateway');
 * log.info('connected');
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
