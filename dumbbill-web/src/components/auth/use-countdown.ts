'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A "wait N seconds" timer, used when the API says "too many attempts, try again in N seconds".
 *
 *   const wait = useCountdown();
 *   wait.start(60);          // begin
 *   wait.secondsLeft         // 60, 59, 58 ... 0 (0 = not waiting)
 *
 * The end time is remembered as a clock time rather than counting ticks, so the countdown stays correct even if
 * the browser pauses the page's timers (a background tab, a sleeping laptop).
 */
export function useCountdown(): {
  secondsLeft: number;
  start: (seconds: number) => void;
  clear: () => void;
} {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setEndsAt(null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  const start = useCallback((seconds: number) => setEndsAt(Date.now() + seconds * 1000), []);
  const clear = useCallback(() => {
    setEndsAt(null);
    setSecondsLeft(0);
  }, []);
  return { secondsLeft, start, clear };
}
