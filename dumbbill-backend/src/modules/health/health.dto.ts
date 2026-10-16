import { ApiProperty } from '@nestjs/swagger';

export class HealthStatusDto {
  @ApiProperty({ example: 'ok', description: 'Always "ok" while the process is running.' })
  status!: 'ok';
}

export class ReadinessChecksDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'], description: 'PostgreSQL connectivity.' })
  database!: 'up' | 'down';
}

export class ReadinessDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}
