import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Filters for the audit log viewer. */
export class ListAuditQueryDto {
  @ApiPropertyOptional({
    example: 'stock.',
    description: 'Events whose name starts with this, for example "stock." or "auth.login".',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ example: 'product', description: 'What it was done to.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entity?: string;

  @ApiPropertyOptional({ description: 'Who did it.' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z', description: 'From this time.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59.999Z', description: 'Until this time.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AuditEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ example: 'stock.adjusted', description: 'A dotted event name.' })
  action!: string;

  @ApiProperty({ nullable: true, example: 'product' })
  entity!: string | null;

  @ApiProperty({ nullable: true })
  entityId!: string | null;

  @ApiProperty({ nullable: true })
  actorUserId!: string | null;

  @ApiProperty({ nullable: true, example: 'Ravi Mehta' })
  actorName!: string | null;

  @ApiProperty({ nullable: true, example: 'Owner', description: 'The role they held at the time.' })
  actorRole!: string | null;

  @ApiProperty({ nullable: true, example: '103.21.58.14' })
  ipAddress!: string | null;

  @ApiProperty({ nullable: true, description: 'The browser or app they used (the device).' })
  userAgent!: string | null;

  @ApiProperty({ nullable: true, description: 'Matches the request id in the technical logs.' })
  requestId!: string | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'Small extra facts. Never secrets or costs.',
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'The state before the change, when recorded.',
  })
  before!: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'The state after the change, when recorded.',
  })
  after!: Record<string, unknown> | null;
}

export class AuditListDto {
  @ApiProperty({ type: [AuditEntryDto], description: 'Newest first.' })
  items!: AuditEntryDto[];

  @ApiProperty({ example: 420 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class AuditVerifyDto {
  @ApiProperty({ description: 'True when every sealed audit entry still matches its seal.' })
  ok!: boolean;

  @ApiProperty({ example: 420, description: 'Entries sealed so far.' })
  sealed!: number;

  @ApiProperty({
    example: 0,
    description: 'Entries written but not yet sealed (sealed whenever the log is viewed).',
  })
  unsealed!: number;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'The first seal that does not match, when ok is false.',
  })
  firstBrokenSeq!: number | null;

  @ApiProperty({ nullable: true, example: null })
  problem!: string | null;
}
