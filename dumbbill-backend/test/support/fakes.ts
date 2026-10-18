import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { Clock } from '../../src/common/clock';

/**
 * A clock the test controls. Start it at the real "now" (tokens and the database use real-looking dates),
 * then move it forward to test expiry, lockouts and "30 days later" without waiting.
 */
export class FakeClock extends Clock {
  private current: number;

  constructor(start: Date = new Date()) {
    super();
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  /** Move time forward by this many seconds. */
  advanceSeconds(seconds: number): void {
    this.current += seconds * 1000;
  }
}

/** A logger that records what was written, so tests can check what was (and was not) logged. */
export class RecordingLogger {
  readonly lines: Array<{ level: string; entry: unknown }> = [];

  log(entry: unknown): void {
    this.lines.push({ level: 'log', entry });
  }
  warn(entry: unknown): void {
    this.lines.push({ level: 'warn', entry });
  }
  error(entry: unknown): void {
    this.lines.push({ level: 'error', entry });
  }

  /** Typed for places that expect the nestjs-pino Logger. */
  asLogger(): Logger {
    return this as unknown as Logger;
  }
}

/** A ConfigService backed by a plain object. */
export function fakeConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}
