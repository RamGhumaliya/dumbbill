import { Params } from 'nestjs-pino';

/**
 * Builds the logger settings.
 *
 * Output format:
 *  - production: one JSON object per line (easy for log tools to search and filter)
 *  - development: the same data, but coloured and readable in the terminal (pino-pretty)
 *
 * This is the baseline. Request-id tracking and the full list of fields to hide
 * (passwords, cost prices, phone numbers ...) are added in step P0-3.
 */
export function buildLoggerParams(level: string, isProduction: boolean): Params {
  return {
    pinoHttp: {
      level,

      // Never write login tokens or cookies into logs.
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },

      // Health checks run every few seconds; logging them would drown out real traffic.
      autoLogging: { ignore: (req) => req.url === '/healthz' },

      ...(isProduction
        ? {}
        : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
    },
  };
}
