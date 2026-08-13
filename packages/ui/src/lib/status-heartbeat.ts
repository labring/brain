"use client";

import { useEffect } from "react";

import {
  isEffectivelyVisible,
  subscribeEffectiveVisibility,
} from "./effective-visibility";

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
  periodMs?: number;
}

const ATTRIBUTE = "data-status-heartbeat";
const DEFAULT_PERIOD_MS = 2000;

export function createStatusHeartbeat(
  root: StatusHeartbeatRoot,
  options?: StatusHeartbeatOptions
) {
  const periodMs = options?.periodMs ?? DEFAULT_PERIOD_MS;
  let phase: "a" | "b" = "b";
  let refCount = 0;
  let suspended = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function beat() {
    phase = phase === "a" ? "b" : "a";
    root.setAttribute(ATTRIBUTE, phase);
  }

  function stopTimer() {
    if (timer === null) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (suspended) {
      return;
    }
    timer = setTimeout(() => {
      beat();
      schedule();
    }, periodMs);
  }

  return {
    /** Starts beating on first acquire; returns the matching release. */
    acquire() {
      refCount += 1;
      if (refCount === 1 && !suspended) {
        beat();
        schedule();
      }
      return () => {
        refCount -= 1;
        if (refCount > 0) {
          return;
        }
        stopTimer();
        root.removeAttribute(ATTRIBUTE);
      };
    },
    /**
     * Pauses beats while the app is not effectively visible (hidden tab or
     * hidden desktop window); each flip forces a root-attribute style recalc
     * that nobody can see. Resuming beats immediately.
     */
    setSuspended(next: boolean) {
      if (next === suspended) {
        return;
      }
      suspended = next;
      if (suspended) {
        stopTimer();
        return;
      }
      if (refCount > 0) {
        beat();
        schedule();
      }
    },
  };
}

type StatusHeartbeat = ReturnType<typeof createStatusHeartbeat>;

let sharedHeartbeat: StatusHeartbeat | null = null;

function getSharedHeartbeat(): StatusHeartbeat {
  if (sharedHeartbeat === null) {
    const heartbeat = createStatusHeartbeat(document.documentElement);
    heartbeat.setSuspended(!isEffectivelyVisible());
    subscribeEffectiveVisibility((visible) => {
      heartbeat.setSuspended(!visible);
    });
    sharedHeartbeat = heartbeat;
  }
  return sharedHeartbeat;
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
