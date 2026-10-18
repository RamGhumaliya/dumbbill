/**
 * The "lockout and backoff" rule for repeated wrong passwords (US-AUTH-02: lockout after 5 failures).
 *
 * The first 4 wrong attempts are free. From the 5th, the account is locked for a short time that doubles
 * with every further failure, up to a cap:
 *
 *   failures:  1-4    5      6      7      8      9+
 *   locked:    no     1 min  2 min  4 min  8 min  15 min
 *
 * Why not lock for a day? A permanent or very long lockout lets a stranger lock a shop owner out of their
 * own business just by typing a wrong password for them. A short, growing delay makes guessing hopeless
 * (a few attempts per hour) without giving the stranger that power.
 */

/** Wrong attempts allowed before the first lockout. */
export const FREE_ATTEMPTS = 4;
/** Longest lockout, in seconds. */
export const MAX_LOCK_SECONDS = 15 * 60;
/** How long a run of failures is remembered with no new failure, in seconds. */
export const FAILURE_MEMORY_SECONDS = 60 * 60;

/** Seconds to lock the account after this many consecutive failures (0 = no lock yet). */
export function lockSecondsForFailures(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS - 1;
  return Math.min(60 * 2 ** doublings, MAX_LOCK_SECONDS);
}
