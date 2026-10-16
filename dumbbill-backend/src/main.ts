// Must be the first import: NestJS and our validation decorators rely on it.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { setupSwagger } from './swagger';

/**
 * Program entry point: builds the app, applies shared settings, publishes the API docs
 * at /docs, and starts listening for requests.
 */
async function bootstrap(): Promise<void> {
  // bufferLogs keeps early startup messages until our JSON logger is ready,
  // so no line is printed in a different format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  configureApp(app); // logging, input validation, shutdown handling
  setupSwagger(app); // interactive API docs at /docs

  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);
}

// `void` makes it explicit that we start the app and do not wait on it here.
void bootstrap();
