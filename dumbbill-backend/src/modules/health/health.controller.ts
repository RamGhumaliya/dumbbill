import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { HealthStatusDto, ReadinessDto } from './health.dto';

/**
 * Two probes used by monitoring tools and deployment checks:
 *  - /healthz  "is the process alive?"       (restart the app if this fails)
 *  - /readyz   "can it serve real requests?"  (stop sending traffic if this fails)
 * They are separate on purpose: a database outage should stop traffic, not restart the app.
 */
@ApiTags('System')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Liveness check',
    description:
      'Returns 200 while the process is running. Does not touch the database, so load balancers can use it without causing restarts during a database outage.\n\nPermission: public.',
  })
  @ApiOkResponse({ type: HealthStatusDto, description: 'Process is alive.' })
  live(): HealthStatusDto {
    return { status: 'ok' };
  }

  @Get('readyz')
  @ApiOperation({
    summary: 'Readiness check',
    description:
      'Returns 200 only when the API can reach PostgreSQL. Use for deployment gates and uptime monitoring.\n\nPermission: public.',
  })
  @ApiOkResponse({ type: ReadinessDto, description: 'All dependencies reachable.' })
  @ApiResponse({
    status: 503,
    description: 'A dependency is unreachable.',
    schema: {
      example: {
        type: 'https://api.dumbbill.in/errors/not-ready',
        title: 'Service not ready',
        status: 503,
        code: 'NOT_READY',
        detail: 'Database is unreachable.',
        requestId: '01JA0000000000000000000000',
      },
    },
  })
  async ready(): Promise<ReadinessDto> {
    try {
      // The cheapest possible query: proves the database answers without reading any data.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        title: 'Service not ready',
        detail: 'Database is unreachable.',
      });
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
