import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { HealthController } from '../../src/modules/health/health.controller';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * Runs the real controller through the real validation/logging setup, but replaces the database
 * with a stub so the test needs no running Postgres. Each test controls whether the "database" answers.
 */
describe('Health endpoints', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: { level: 'silent' } })],
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('GET /healthz returns 200 without touching the database', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('GET /readyz returns 200 when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    await request(app.getHttpServer())
      .get('/readyz')
      .expect(200, { status: 'ok', checks: { database: 'up' } });
  });

  it('GET /readyz returns 503 when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/readyz').expect(503);
    expect(res.body.code).toBe('NOT_READY');
  });
});
