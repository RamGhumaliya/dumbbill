import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

/**
 * Settings applied to the running app. Kept separate from main.ts so the automated tests
 * start the app with exactly the same rules as production.
 */
export function configureApp(app: INestApplication): void {
  // Send Nest's own log messages through our JSON logger too.
  app.useLogger(app.get(Logger));

  // Check every incoming request body, query and parameter against its DTO class.
  //  - whitelist: silently drop fields the DTO does not declare
  //  - forbidNonWhitelisted: ...but reject the request instead if any such field is sent.
  //    This stops clients from sneaking in fields like "tenantId" or "role".
  //  - transform: convert plain JSON into DTO class instances (and "5" into the number 5).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // On SIGTERM (a normal stop) finish in-flight requests and close DB connections cleanly.
  app.enableShutdownHooks();
}
