/**
 * "What time is it?" as an injectable service.
 *
 * Code that cares about time (token expiry, lockouts, "used a few seconds ago") asks this instead of
 * calling `new Date()`. In production it is the real clock; in tests a fake clock is swapped in, so a test can
 * say "30 days later" without waiting 30 days.
 */
export abstract class Clock {
  /** The current moment. */
  abstract now(): Date;
}

/** The real clock. */
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
