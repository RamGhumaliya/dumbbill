/**
 * OpenTelemetry tracing: records how long each request and each step inside it took, so slow
 * requests can be found and explained. Each unit of work is a "span"; all spans of one request
 * share a `traceId`, which is also written to the logs so a log line can be matched to its trace.
 *
 * This file MUST be imported first in main.ts, before NestJS and Express are loaded, because the
 * instrumentation works by wrapping those libraries as they load.
 *
 * Controlled by the OTEL_EXPORTER setting:
 *   none     (default) tracing is off and adds no overhead
 *   console  every finished span is printed to the terminal; for learning and debugging locally
 * Sending traces to a real backend (CloudWatch/X-Ray, Grafana ...) is added when the app is deployed.
 */
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// This file runs before the config system, so it reads the .env file itself.
// Node's built-in loader never overrides variables that are already set in the real environment.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file (for example in production): the real environment variables are used.
}

let sdk: NodeSDK | undefined;

if (process.env.OTEL_EXPORTER === 'console') {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'dumbbill-api',
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? 'dev',
    }),
    traceExporter: new ConsoleSpanExporter(),
    instrumentations: [
      new HttpInstrumentation({
        // Health checks would flood the output.
        ignoreIncomingRequestHook: (req) => req.url === '/healthz',
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
    ],
  });
  sdk.start();
  // Flush any buffered spans when the process is asked to stop.
  process.once('SIGTERM', () => void sdk?.shutdown());
}

/** True when tracing is active (used by tests and the start-up message). */
export const tracingEnabled = sdk !== undefined;
