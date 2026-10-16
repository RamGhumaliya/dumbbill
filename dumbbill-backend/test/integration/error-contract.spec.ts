import {
  Body,
  Controller,
  Get,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  RequestMethod,
} from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, IsString, Min } from 'class-validator';
import { Logger, LoggerModule } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { DomainError } from '../../src/common/errors/domain-error';
import { buildLoggerParams } from '../../src/common/logging/logger.config';
import { findLeakedSecrets } from '../../src/common/logging/redaction';
import { RequestContextMiddleware } from '../../src/common/request-context/request-context.middleware';
import { ReportTags } from '../../src/observability/sentry';

/**
 * End-to-end check of the error and logging contract, using the real middleware, logger, filter and
 * validation pipe. Only the routes below are fake. The logger writes into memory so the test can
 * read every log line the request produced.
 *
 * The acceptance checks from the plan:
 *   - a thrown error shows the SAME request id in the log, the response body and the response header
 *   - secrets are redacted from logs
 */

class CreateItemDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

@Controller()
class FakeController {
  constructor(private readonly logger: Logger) {}

  @Get('ok')
  ok(): { ok: boolean } {
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
  }

  @Get('rule')
  rule(): never {
    throw new DomainError('DISCOUNT_EXCEEDS_LIMIT', 'Maximum allowed is 5%.');
  }

  @Get('other-business')
  otherBusiness(): never {
    const error = new Error('new row violates row-level security policy for table "users"');
    error.name = 'PrismaClientKnownRequestError';
    throw error;
  }

  @Get('log-secrets')
  logSecrets(): { ok: boolean } {
    // A developer logging a whole request body by mistake. The logger must clean it.
    this.logger.log({
      msg: 'Mistaken log of a body',
      body: { email: 'owner@shop.test', password: 'hunter2', pin: '4321' },
      cost: { unitCost: 1999, wac: 1750, nested: { profit: 250 } },
    });
    return { ok: true };
  }

  @Post('items')
  create(@Body() body: CreateItemDto): CreateItemDto {
    return body;
  }
}

/** In-memory log destination: collects every line as parsed JSON. */
class MemoryStream extends Writable {
  lines: Array<Record<string, unknown>> = [];
  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    for (const line of chunk.toString().split('\n').filter(Boolean))
      this.lines.push(JSON.parse(line));
    callback();
  }
  reset(): void {
    this.lines = [];
  }
}

const stream = new MemoryStream();
const reported: Array<{ error: unknown; tags: ReportTags }> = [];

@Module({
  imports: [
    LoggerModule.forRoot(
      buildLoggerParams({
        level: 'debug',
        isProduction: true,
        environment: 'test',
        version: 'test',
        stream,
      }),
    ),
  ],
  controllers: [FakeController],
})
class FakeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}

describe('error and logging contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [FakeModule] }).compile()
    ).createNestApplication();
    configureApp(app, (error, tags) => reported.push({ error, tags }));
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    stream.reset();
    reported.length = 0;
  });

  /**
   * The "request completed" line for the request with this id. The logger writes it a moment AFTER the
   * response is sent, so wait briefly (up to 1 second) for it to appear.
   */
  async function completedLine(requestId: string): Promise<Record<string, unknown> | undefined> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const line = stream.lines.find(
        (l) => l.requestId === requestId && /^request (completed|errored)$/.test(String(l.msg)),
      );
      if (line) return line;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  describe('request ids', () => {
    it('a successful response carries an X-Request-Id header, and the same id is in the log', async () => {
      const res = await request(app.getHttpServer()).get('/ok').expect(200);
      const id = res.headers['x-request-id'] as string;
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(await completedLine(id)).toMatchObject({
        requestId: id,
        service: 'dumbbill-api',
        env: 'test',
        version: 'test',
      });
    });

    it('reuses a safe id sent by the caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/ok')
        .set('X-Request-Id', 'web-abc12345-trace')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('web-abc12345-trace');
      expect(await completedLine('web-abc12345-trace')).toBeDefined();
    });

    it('replaces an unsafe id (log-injection attempt) with a fresh one', async () => {
      const res = await request(app.getHttpServer())
        .get('/ok')
        .set('X-Request-Id', 'bad id with spaces!')
        .expect(200);
      expect(res.headers['x-request-id']).not.toContain(' ');
      expect(res.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });
  });

  describe('a thrown error shows the SAME request id in the response, the header and the log', () => {
    it('unexpected failure -> 500 INTERNAL_ERROR, logged as an error with its stack, reported, nothing leaked', async () => {
      const res = await request(app.getHttpServer()).get('/boom').expect(500);
      const id = res.headers['x-request-id'] as string;

      // response
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', requestId: id });
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);

      // log: an error line with the stack, carrying the same id
      const errorLine = stream.lines.find(
        (l) => l.requestId === id && l.level === 50 && l.msg === 'Unexpected error',
      );
      expect(errorLine).toBeDefined();
      expect((errorLine?.err as { stack?: string }).stack).toContain('FakeController');

      // the request-completed line is an error too, with the same id
      expect(await completedLine(id)).toMatchObject({ level: 50, res: { statusCode: 500 } });

      // Sentry would be told, with the same id
      expect(reported).toHaveLength(1);
      expect(reported[0]?.tags).toMatchObject({ requestId: id, code: 'INTERNAL_ERROR' });
    });

    it('business rule -> 422 with the catalogue code, a warning in the log, NOT sent to Sentry', async () => {
      const res = await request(app.getHttpServer()).get('/rule').expect(422);
      const id = res.headers['x-request-id'] as string;
      expect(res.body).toMatchObject({
        code: 'DISCOUNT_EXCEEDS_LIMIT',
        detail: 'Maximum allowed is 5%.',
        requestId: id,
      });
      expect(await completedLine(id)).toMatchObject({ level: 40 }); // warn
      expect(reported).toHaveLength(0);
    });

    it('unknown route -> 404 NOT_FOUND in the standard format', async () => {
      const res = await request(app.getHttpServer()).get('/no-such-route').expect(404);
      expect(res.body).toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
        requestId: res.headers['x-request-id'],
      });
    });

    it("another business's data -> 404 (never confirms it exists), logged as a security event", async () => {
      const res = await request(app.getHttpServer()).get('/other-business').expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/row-level|users/);
      const security = stream.lines.find((l) => l.event === 'rls.violation');
      expect(security).toMatchObject({ level: 40, requestId: res.headers['x-request-id'] });
      expect(reported).toHaveLength(0);
    });
  });

  describe('validation errors', () => {
    it('reports every bad field in the standard format and never echoes the rejected value', async () => {
      const res = await request(app.getHttpServer())
        .post('/items')
        .send({ name: 12345, quantity: 0 })
        .expect(400);
      expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
      const fields = (res.body.errors as Array<{ field: string }>).map((e) => e.field).sort();
      expect(fields).toEqual(['name', 'quantity']);
      expect(JSON.stringify(res.body)).not.toContain('12345');
    });

    it('rejects fields that are not allowed, such as a tenantId sent by the client', async () => {
      const res = await request(app.getHttpServer())
        .post('/items')
        .send({ name: 'Whey', quantity: 1, tenantId: 'x' })
        .expect(400);
      expect(res.body.errors).toEqual([
        { field: 'tenantId', message: 'property tenantId should not exist' },
      ]);
    });

    it('accepts a valid body', async () => {
      await request(app.getHttpServer())
        .post('/items')
        .send({ name: 'Whey 2 lb', quantity: 2 })
        .expect(201);
    });

    it('reports malformed JSON as a 400 in the standard format', async () => {
      const res = await request(app.getHttpServer())
        .post('/items')
        .set('Content-Type', 'application/json')
        .send('{ not json')
        .expect(400);
      expect(res.body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
    });
  });

  describe('log redaction', () => {
    it('removes passwords, pins and cost/profit fields from a log line, at any depth', async () => {
      await request(app.getHttpServer()).get('/log-secrets').expect(200);
      const line = stream.lines.find((l) => l.msg === 'Mistaken log of a body');
      expect(line).toBeDefined();
      expect(findLeakedSecrets(line)).toEqual([]);
      const raw = JSON.stringify(stream.lines);
      for (const secret of ['hunter2', '4321', '1999', '1750']) {
        expect(raw).not.toContain(secret);
      }
      // Ordinary data and a shortened email are still there for debugging.
      expect((line?.body as { email: string }).email).toBe('o***@shop.test');
    });

    it('never writes request headers, cookies or query strings into the request line', async () => {
      await request(app.getHttpServer())
        .get('/ok?apiKey=SECRETVALUE')
        .set('Authorization', 'Bearer SUPERSECRETTOKEN')
        .set('Cookie', 'session=COOKIEVALUE')
        .expect(200);
      const raw = JSON.stringify(stream.lines);
      for (const secret of ['SECRETVALUE', 'SUPERSECRETTOKEN', 'COOKIEVALUE']) {
        expect(raw).not.toContain(secret);
      }
      expect(stream.lines.find((l) => l.msg === 'request completed')).toMatchObject({
        req: { method: 'GET', path: '/ok' },
      });
    });

    it('every line written during these tests is free of leaked secrets', async () => {
      await request(app.getHttpServer()).get('/boom');
      await request(app.getHttpServer()).get('/log-secrets');
      for (const line of stream.lines) expect(findLeakedSecrets(line)).toEqual([]);
    });
  });
});
