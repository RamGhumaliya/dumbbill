import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
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
    operationId: 'getLiveness',
    summary: 'Liveness check',
    description:
      'Returns 200 while the process is running. Does not touch the database, so load balancers can use it without causing restarts during a database outage.\n\nPermission: public.',
  })
  @ApiOkResponse({ type: HealthStatusDto, description: 'Process is alive.' })
  @ApiProblemResponse('INTERNAL_ERROR', { description: 'Unexpected failure inside the process.' })
  getLiveness(): HealthStatusDto {
    return { status: 'ok' };
  }

  @Get('readyz')
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Readiness check',
    description:
      'Returns 200 only when the API can reach PostgreSQL. Use for deployment gates and uptime monitoring.\n\nPermission: public.',
  })
  @ApiOkResponse({ type: ReadinessDto, description: 'All dependencies reachable.' })
  @ApiProblemResponse('NOT_READY', {
    description: 'A dependency is unreachable.',
    detail: 'Database is unreachable.',
  })
  async getReadiness(): Promise<ReadinessDto> {
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
