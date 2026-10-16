// MUST stay the first import: tracing works by wrapping http/express as they load.
import './observability/tracing';
// Must come before NestJS: our validation decorators rely on it.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { initSentry } from './observability/sentry';
import { setupSwagger } from './swagger';

/**
 * Program entry point: builds the app, applies shared settings, publishes the API docs
 * at /docs, and starts listening for requests.
 */
async function bootstrap(): Promise<void> {
  // bufferLogs keeps early startup messages until our JSON logger is ready,
  // so no line is printed in a different format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // Error tracking is switched on only when SENTRY_DSN is set.
  initSentry({
    dsn: config.get<string>('SENTRY_DSN'),
    environment: config.getOrThrow<string>('NODE_ENV'),
    release: config.getOrThrow<string>('APP_VERSION'),
  });

  configureApp(app); // logging, error format, input validation, shutdown handling
  setupSwagger(app); // interactive API docs at /docs

  await app.listen(config.getOrThrow<number>('PORT'));
}

// `void` makes it explicit that we start the app and do not wait on it here.
void bootstrap();
