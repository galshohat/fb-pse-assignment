import { useEffect, useState } from 'react';

/**
 * Seconds since a write was sent.
 *
 * A spinner on its own says "something is happening"; a spinner with a running
 * count says how long it has been happening, which is what tells someone
 * whether a transaction is taking a normal amount of time or has stalled.
 * Pass `undefined` when nothing is in flight and the timer stops.
 */
export function useElapsedSeconds(startedAt: number | undefined): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (startedAt === undefined) {
      setSeconds(0);
      return;
    }

    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1_000);

    return () => clearInterval(timer);
  }, [startedAt]);

  return seconds;
}
