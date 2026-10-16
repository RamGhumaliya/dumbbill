import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Groups the /healthz and /readyz probes used by monitoring and deployment tools. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
