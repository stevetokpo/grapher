import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { aggregateBars, TF_MINUTES } from '../lib/replayUtils';

export const REPLAY_SPEEDS = [1, 2, 5, 10, 50, 100];
const TICK_MS = 200;

export function useReplay(allM1Bars, tf) {
  const [cursor,    setCursor]    = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed,     setSpeed]     = useState(1);
  const [stepSize,  setStepSize]  = useState(5);

  // Refs for stable closure access inside interval / functional updaters
  const cursorRef    = useRef(0);
  const speedRef     = useRef(1);
  const tfRef        = useRef(tf);
  const totalRef     = useRef(0);
  const stepSizeRef  = useRef(5);

  useEffect(() => { totalRef.current    = allM1Bars.length; }, [allM1Bars.length]);
  useEffect(() => { speedRef.current    = speed;            }, [speed]);
  useEffect(() => { tfRef.current       = tf;               }, [tf]);
  useEffect(() => { stepSizeRef.current = stepSize;         }, [stepSize]);

  // Reset when a new replay session starts (new bars loaded)
  useEffect(() => {
    cursorRef.current = 0;
    setCursor(0);
    setIsPlaying(false);
  }, [allM1Bars]);

  // Auto-advance timer
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
        // Always advance in M1 bars — TF only controls display aggregation
      const m1PerTick = speedRef.current;
      const next      = Math.min(cursorRef.current + m1PerTick, totalRef.current);
      cursorRef.current = next;
      setCursor(next);
      if (next >= totalRef.current) setIsPlaying(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [isPlaying]);

  const play = useCallback(() => {
    if (cursorRef.current < totalRef.current) setIsPlaying(true);
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  // Step forward/back by stepSize candles at current TF (all refs → stable identity)
  const stepForward = useCallback(() => {
    setIsPlaying(false);
    setCursor(prev => {
      const m1Step = (TF_MINUTES[tfRef.current] ?? 1) * stepSizeRef.current;
      const next   = Math.min(prev + m1Step, totalRef.current);
      cursorRef.current = next;
      return next;
    });
  }, []);

  const stepBack = useCallback(() => {
    setIsPlaying(false);
    setCursor(prev => {
      const m1Step = (TF_MINUTES[tfRef.current] ?? 1) * stepSizeRef.current;
      const next   = Math.max(prev - m1Step, 0);
      cursorRef.current = next;
      return next;
    });
  }, []);

  const seekToPercent = useCallback((pct) => {
    const next = Math.floor(Math.max(0, Math.min(1, pct)) * totalRef.current);
    cursorRef.current = next;
    setCursor(next);
  }, []);

  // Aggregate M1 bars up to cursor into the selected TF — memoized, O(cursor)
  const visibleBars = useMemo(
    () => aggregateBars(allM1Bars, tf, cursor),
    [allM1Bars, tf, cursor],
  );

  return {
    visibleBars,
    cursor,
    total: allM1Bars.length,
    isPlaying,
    speed,    setSpeed,
    stepSize, setStepSize,
    play, pause, stepForward, stepBack, seekToPercent,
  };
}
