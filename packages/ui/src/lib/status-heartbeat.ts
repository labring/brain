"use client";

import { useEffect } from "react";

/**
 * Shared scheduler for status-dot ping pulses. Breathing dots opt in with
 * `useStatusHeartbeat` plus the `status-heartbeat-ping` class (globals.css):
 * each beat flips `data-status-heartbeat` between "a"/"b" on the root
 * element, restarting a one-shot copy of the `ping` animation on every
 * subscribed dot at once. Between beats no animation is active, so the
 * compositor produces no frames — an infinite `animate-ping` keeps the whole
 * frame pipeline running at display refresh rate even for a single dot, and
 * unsynchronized per-dot timers would leave the pipeline almost always busy.
 */

export interface StatusHeartbeatRoot {
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

export interface StatusHeartbeatOptions {
  /** Floor for `setPeriodMs`; a beat must outlast the pulse animation. */
  minPeriodMs?: number;
  periodMs?: number;
}

const ATTRIBUTE = "data-status-heartbeat";
const DEFAULT_PERIOD_MS = 2000;
const DEFAULT_MIN_PERIOD_MS = 1200;

export function createStatusHeartbeat(
  root: StatusHeartbeatRoot,
  options?: StatusHeartbeatOptions
) {
  const minPeriodMs = options?.minPeriodMs ?? DEFAULT_MIN_PERIOD_MS;
  let periodMs = Math.max(minPeriodMs, options?.periodMs ?? DEFAULT_PERIOD_MS);
  let phase: "a" | "b" = "b";
  let refCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function beat() {
    phase = phase === "a" ? "b" : "a";
    root.setAttribute(ATTRIBUTE, phase);
  }

  function schedule() {
    timer = setTimeout(() => {
      beat();
      schedule();
    }, periodMs);
  }

  return {
    /** Starts beating on first acquire; returns the matching release. */
    acquire() {
      refCount += 1;
      if (refCount === 1) {
        beat();
        schedule();
      }
      return () => {
        refCount -= 1;
        if (refCount > 0 || timer === null) {
          return;
        }
        clearTimeout(timer);
        timer = null;
        root.removeAttribute(ATTRIBUTE);
      };
    },
    setPeriodMs(nextMs: number) {
      const clamped = Math.max(minPeriodMs, Math.round(nextMs));
      if (clamped === periodMs) {
        return;
      }
      periodMs = clamped;
      if (timer !== null) {
        clearTimeout(timer);
        schedule();
      }
    },
  };
}

type StatusHeartbeat = ReturnType<typeof createStatusHeartbeat>;

let sharedHeartbeat: StatusHeartbeat | null = null;

function getSharedHeartbeat(): StatusHeartbeat {
  sharedHeartbeat ??= createStatusHeartbeat(document.documentElement);
  return sharedHeartbeat;
}

/** Live-tunes the shared beat period (dev tweaks pane). */
export function setStatusHeartbeatPeriodMs(nextMs: number) {
  if (typeof document === "undefined") {
    return;
  }
  getSharedHeartbeat().setPeriodMs(nextMs);
}

/**
 * Keeps the shared heartbeat running while any breathing dot is mounted.
 * Non-breathing dots pass `active: false` so hook calls stay unconditional.
 */
export function useStatusHeartbeat(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    return getSharedHeartbeat().acquire();
  }, [active]);
}
