// Polls a sample-data run every 2 s while it is queued, running or removing, and stops after
// 10 minutes with a "still running" flag. fetchStatus(run) must resolve to {ok, data:{run}}.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isSeedActive, pollDecision, POLL_MS } from '../lib/view.js';

export function useSeedRun(fetchStatus, onFinished) {
  const [run, setRun] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const [pollError, setPollError] = useState(null);
  const [tick, setTick] = useState(0);
  const startedRef = useRef(Date.now());
  // Latest callbacks, so a poll that fires later never uses a stale closure.
  const fetchRef = useRef(fetchStatus);
  const finishedRef = useRef(onFinished);
  fetchRef.current = fetchStatus;
  finishedRef.current = onFinished;

  const track = useCallback((next) => {
    startedRef.current = Date.now();
    setTimedOut(false);
    setPollError(null);
    setRun(next ?? null);
  }, []);

  const resume = useCallback(() => {
    startedRef.current = Date.now();
    setTimedOut(false);
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isSeedActive(run) || timedOut) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (pollDecision(run, startedRef.current, Date.now()) === 'timeout') {
        setTimedOut(true);
        return;
      }
      const r = await fetchRef.current(run);
      if (cancelled) return;
      if (!r.ok) {
        setPollError(r.error);
        setTick((n) => n + 1);
        return;
      }
      setPollError(null);
      const next = r.data?.run ?? null;
      setRun(next);
      if (!isSeedActive(next) && finishedRef.current) finishedRef.current(next);
      else setTick((n) => n + 1);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [run, tick, timedOut]);

  return { run, track, timedOut, pollError, resume };
}
