"use client";

import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * Returns a referentially permanent function that always invokes the latest
 * `callback`. Use for event-time and effect-time handlers that must not
 * invalidate memoized consumers (canvas meta, node action builders, command
 * dispatch). The returned function must not be called during render.
 */
export function useStableCallback<TArgs extends unknown[], TResult>(
  callback: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  const callbackRef = useRef(callback);
  useInsertionEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback((...args: TArgs) => callbackRef.current(...args), []);
}
