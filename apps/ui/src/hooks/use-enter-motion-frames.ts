"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Defers a rising edge by two animation frames — the `SidePanePresence` enter
 * beat: the closed pose paints first and the triggering commit's work stays
 * out of the motion-start frame, so transitions begin from a visible origin
 * on a clean frame. Falling edges apply immediately. An already-true initial
 * value never animates.
 */
export function useEnterMotionFrames(open: boolean) {
  const [motionOpen, setMotionOpen] = useState(open);

  useLayoutEffect(() => {
    if (!open) {
      setMotionOpen(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setMotionOpen(true);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return motionOpen;
}
