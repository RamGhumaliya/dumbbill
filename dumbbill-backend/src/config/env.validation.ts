import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
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

/** Where tracing data goes. `none` = tracing off; `console` = print spans to the terminal. */
export enum OtelExporter {
  None = 'none',
  Console = 'console',
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

  /**
   * Connection the running API uses. It must be the restricted app role (NOBYPASSRLS), never the owner,
   * so row-level security always applies to requests.
   */
  @IsString()
  APP_DATABASE_URL!: string;

  /**
   * Owner connection, used only by tooling (migrations, seeds, role setup). The running API does not
   * need it, so production servers may leave it unset.
   */
  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  /** Redis connection string (used for queues, caching and rate limits). */
  @IsUrl({ protocols: ['redis', 'rediss'], require_tld: false })
  REDIS_URL!: string;

  /** Error-tracking address from Sentry. Leave empty to turn error tracking off. */
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  /** Version written on every log line and Sentry report. Set it in the deployment (for example the git tag). */
  @IsString()
  APP_VERSION: string = 'dev';

  /** Tracing output: `none` (default) or `console` (print spans, for debugging). Read by observability/tracing.ts. */
  @IsEnum(OtelExporter)
  OTEL_EXPORTER: OtelExporter = OtelExporter.None;

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

  // ---------------------------------------------------------------------------------------------
  // Sign-in and security (P1-1). Secrets below are OPTIONAL in development (safe throw-away values
  // are used, with a warning) but REQUIRED in production, where validateEnv refuses to start without them.
  // ---------------------------------------------------------------------------------------------

  /** Address of the web app. Used to build the links in emails (verify email, reset password). */
  @IsUrl({ require_tld: false })
  WEB_BASE_URL: string = 'http://localhost:3001';

  /** Web origins allowed to call the API from a browser (CORS), comma separated. Never use `*`. */
  @IsString()
  CORS_ALLOWED_ORIGINS: string = 'http://localhost:3001';

  /**
   * Domain of the sign-in cookies, for example `.dumbbill.in` so the web app (app.dumbbill.in) and the API
   * (api.dumbbill.in) share them. Leave empty in development (the cookie then belongs to `localhost`).
   */
  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;

  /**
   * How many proxies sit in front of the API (load balancer, CDN). 0 = none. It decides which part of
   * `X-Forwarded-For` is trusted as the visitor's IP address, which rate limits and sessions rely on.
   * A wrong value lets visitors fake their address, so set it exactly.
   */
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  /**
   * Private key that signs access tokens (Ed25519, PKCS#8 PEM, then base64-encoded so it fits on one line).
   * Create one with `pnpm keys:generate`. Development without it uses a throw-away key created at start-up.
   */
  @IsOptional()
  @IsString()
  JWT_PRIVATE_KEY?: string;

  /** Name of the signing key, written in each token header so keys can be rotated. */
  @IsString()
  JWT_KEY_ID: string = 'dev';

  /**
   * Old public keys that may still VERIFY tokens during a key rotation, as `kid:base64(public PEM)` pairs
   * separated by commas. See docs/runbooks/rotate-secrets.md.
   */
  @IsOptional()
  @IsString()
  JWT_PREVIOUS_PUBLIC_KEYS?: string;

  /**
   * Password peppers: `version:secret` pairs separated by commas, for example `1:abc...,2:def...`.
   * The HIGHEST version is used for new passwords; older ones are kept so existing passwords still work
   * until the person next signs in. A pepper is a server-side secret mixed into every password before hashing.
   */
  @IsOptional()
  @IsString()
  PASSWORD_PEPPERS?: string;

  /** Argon2id memory in KiB (65536 = 64 MB, the value in docs/03-engineering/security.md). Tests lower it. */
  @IsInt()
  @Min(8)
  ARGON2_MEMORY_KIB: number = 65536;

  /** Argon2id passes over memory. */
  @IsInt()
  @Min(1)
  @Max(10)
  ARGON2_TIME_COST: number = 3;

  /**
   * Whether new passwords are checked against the Have I Been Pwned breach list. Only the first 5 characters
   * of a one-way hash leave the server (k-anonymity). If the service cannot be reached the check is skipped.
   */
  // The generic text-to-boolean conversion turns ANY non-empty text, including "false", into true, and it runs
  // before this function sees the value. So the raw text is read from the original object instead.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => {
    const raw = obj.PASSWORD_BREACH_CHECK;
    return raw === undefined ? true : raw === true || raw === 'true';
  })
  @IsBoolean()
  PASSWORD_BREACH_CHECK: boolean = true;

  /**
   * DEVELOPMENT ONLY. Switches off every rate limit and the wrong-password lockout, so repeated testing of sign-up,
   * reset and login is never blocked. Production refuses to start with it on. (Read from the raw text for the same
   * reason as PASSWORD_BREACH_CHECK: "false" must not become true.)
   */
  @Transform(({ obj }: { obj: Record<string, unknown> }) => {
    const raw = obj.RATE_LIMIT_DISABLED;
    return raw === true || raw === 'true';
  })
  @IsBoolean()
  RATE_LIMIT_DISABLED: boolean = false;

  /** 32-byte key (base64) that encrypts secrets we must be able to read back, such as TOTP secrets. */
  @IsOptional()
  @IsString()
  DATA_ENCRYPTION_KEY?: string;

  /** SMTP server for outgoing email. Development: Mailpit (`pnpm`/docker compose). Production: SES SMTP endpoint. */
  @IsString()
  MAIL_SMTP_URL: string = 'smtp://localhost:1025';

  /** The "From" address on every email. */
  @IsString()
  MAIL_FROM: string = 'Dumbbill <no-reply@dumbbill.local>';
}

/** Smallest acceptable length for a production secret (peppers). */
const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Extra rules that only apply in production. A development shortcut must never reach a live server,
 * so instead of quietly falling back to throw-away secrets, production refuses to start.
 */
function productionProblems(env: EnvironmentVariables): string[] {
  if (env.NODE_ENV !== NodeEnv.Production) return [];
  const problems: string[] = [];
  if (!env.JWT_PRIVATE_KEY) problems.push('JWT_PRIVATE_KEY is required in production.');
  if (env.JWT_KEY_ID === 'dev') problems.push('JWT_KEY_ID must not be "dev" in production.');
  if (!env.DATA_ENCRYPTION_KEY) problems.push('DATA_ENCRYPTION_KEY is required in production.');
  const peppers = (env.PASSWORD_PEPPERS ?? '').split(',').filter(Boolean);
  if (peppers.length === 0) problems.push('PASSWORD_PEPPERS is required in production.');
  for (const pair of peppers) {
    const secret = pair.slice(pair.indexOf(':') + 1);
    if (!/^\d+:/.test(pair) || secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      problems.push(
        `PASSWORD_PEPPERS entries must look like "1:<secret of at least ${MIN_PRODUCTION_SECRET_LENGTH} characters>".`,
      );
      break;
    }
  }
  if (env.RATE_LIMIT_DISABLED) problems.push('RATE_LIMIT_DISABLED must not be on in production.');
  if (env.ARGON2_MEMORY_KIB < 19456) {
    problems.push('ARGON2_MEMORY_KIB must be at least 19456 in production (OWASP minimum).');
  }
  if (!env.WEB_BASE_URL.startsWith('https://'))
    problems.push('WEB_BASE_URL must use https in production.');
  if (env.CORS_ALLOWED_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
    problems.push('CORS_ALLOWED_ORIGINS must list exact origins, never "*".');
  }
  return problems;
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
  const lines = errors.map(
    (e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
  );
  // Only look for production-specific problems once the basic values are well-formed.
  if (errors.length === 0) lines.push(...productionProblems(env).map((problem) => `  ${problem}`));
  if (lines.length > 0) {
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return env;
}
