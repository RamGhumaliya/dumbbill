import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/** Which environment the app runs in. */
export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** How much the app writes to its logs. `debug` is the noisiest, `fatal` the quietest. */
export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
}

/** Where uploaded files are kept. Only "local" (server disk) exists today; "s3" can be added later. */
export enum StorageDriver {
  Local = 'local',
}

/**
 * Every setting the app reads from the environment (the `.env` file in development).
 *
 * Values written here (`= 3000`) are defaults used when the variable is missing.
 * Variables with `!` have no default and must be provided.
 * See `.env.example` for a ready-to-copy template and `docs/runbooks/local-setup.md` for explanations.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  /** Port the API listens on. */
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Product name shown in emails, invoices and API docs. Change here to rename the product. */
  @IsString()
  BRAND_NAME: string = 'Dumbbill';

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  /** PostgreSQL connection string. */
  @IsString()
  DATABASE_URL!: string;

  /** Redis connection string (used for queues, caching and rate limits). */
  @IsUrl({ protocols: ['redis', 'rediss'], require_tld: false })
  REDIS_URL!: string;

  /** Error-tracking address from Sentry. Leave empty to turn error tracking off. */
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsEnum(StorageDriver)
  STORAGE_DRIVER: StorageDriver = StorageDriver.Local;

  /**
   * Folder where uploaded files are saved when STORAGE_DRIVER=local.
   * A relative path is measured from where the app is started. Back this folder up with the database.
   */
  @IsString()
  STORAGE_LOCAL_DIR: string = './storage';

  /** Largest single upload accepted, in megabytes. */
  @IsInt()
  @Min(1)
  @Max(50)
  STORAGE_MAX_FILE_MB: number = 5;
}

/**
 * Check the raw environment and return clean, correctly typed settings.
 *
 * If anything is wrong the app refuses to start and prints every problem at once,
 * instead of crashing later in the middle of a customer's bill.
 */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  // Env values are always text. `enableImplicitConversion` turns "3000" into the number 3000.
  const env = plainToInstance(EnvironmentVariables, raw, { enableImplicitConversion: true });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return env;
}
