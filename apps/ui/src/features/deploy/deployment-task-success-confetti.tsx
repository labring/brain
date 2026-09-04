"use client";

import { useEffect, useRef } from "react";

/**
 * The Timeline's success celebration (issue #160): a short particle burst drawn
 * on a canvas that belongs to the Timeline surface itself, so it can never
 * cover the rest of the workspace. The visual shape follows the MagicUI
 * confetti pattern — two angled side cannons and one centre burst — but the
 * trigger lives in deployment-task-success-celebration.ts, never here.
 *
 * `canvas-confetti` is loaded lazily: a user who never completes a deployment
 * should not pay for the particle engine in the initial Timeline chunk.
 */

const CONFETTI_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
] as const;

/** Hard ceiling on the animation, so a stuck canvas can never outlive the card. */
const CONFETTI_MAX_MS = 2000;
const CONFETTI_CENTER_BURST_DELAY_MS = 120;

export interface TimelineConfettiShot {
  angle?: number;
  colors?: string[];
  decay?: number;
  gravity?: number;
  origin?: { x: number; y: number };
  particleCount?: number;
  spread?: number;
  startVelocity?: number;
  ticks?: number;
}

export interface TimelineConfettiInstance {
  reset: () => void;
  (shot: TimelineConfettiShot): Promise<unknown> | null;
}

export type TimelineConfettiLoader = () => Promise<
  (canvas: HTMLCanvasElement) => TimelineConfettiInstance
>;

const loadTimelineConfetti: TimelineConfettiLoader = async () => {
  const module = await import("canvas-confetti");
  const confetti = module.default;
  return (canvas) =>
    confetti.create(canvas, {
      disableForReducedMotion: true,
      resize: true,
      useWorker: false,
    }) as unknown as TimelineConfettiInstance;
};

/**
 * Reduced-motion users get the static success treatment instead (US23). This
 * is checked before the particle engine is even loaded, and also passed to
 * canvas-confetti as `disableForReducedMotion`, so both the cost and the
 * animation are avoided rather than just visually hidden.
 */
export function prefersReducedMotion(): boolean {
  const matchMedia = (
    globalThis as {
      matchMedia?: (query: string) => { matches?: boolean };
    }
  ).matchMedia;
  if (typeof matchMedia !== "function") {
    return false;
  }
  try {
    return (
      matchMedia.call(globalThis, "(prefers-reduced-motion: reduce)")
        .matches === true
    );
  } catch {
    return false;
  }
}

/**
 * One celebration's worth of particles, drawn into `canvas`.
 *
 * Velocities are tuned for a panel-sized canvas rather than a full window: the
 * side cannons start low at the edges and the centre burst comes after a short
 * stagger, so the whole effect reads as one gesture inside ~1.8s. Returns
 * whether anything was actually drawn — false means reduced motion or a canvas
 * the browser cannot paint, and the caller keeps the static success state.
 */
export async function fireTimelineSuccessConfetti(
  canvas: HTMLCanvasElement,
  load: TimelineConfettiLoader = loadTimelineConfetti,
  signal?: AbortSignal
): Promise<boolean> {
  if (typeof window === "undefined" || prefersReducedMotion()) {
    return false;
  }
  let instance: TimelineConfettiInstance;
  try {
    instance = (await load())(canvas);
  } catch {
    return false;
  }
  const settle = (shot: TimelineConfettiShot) => {
    try {
      return instance(shot) ?? Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  };
  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => {
    if (signal == null) {
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    if (signal?.aborted) {
      return false;
    }
    await Promise.race([
      (async () => {
        await Promise.all([
          settle({
            angle: 60,
            colors: [...CONFETTI_COLORS],
            decay: 0.92,
            origin: { x: 0, y: 0.72 },
            particleCount: 45,
            spread: 72,
            startVelocity: 27,
            ticks: 220,
          }),
          settle({
            angle: 120,
            colors: [...CONFETTI_COLORS],
            decay: 0.92,
            origin: { x: 1, y: 0.72 },
            particleCount: 45,
            spread: 72,
            startVelocity: 27,
            ticks: 220,
          }),
        ]);
        if (signal?.aborted) {
          return;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, CONFETTI_CENTER_BURST_DELAY_MS);
        });
        if (!signal?.aborted) {
          await settle({
            angle: 90,
            colors: [...CONFETTI_COLORS],
            gravity: 0.9,
            origin: { x: 0.5, y: 0.42 },
            particleCount: 30,
            spread: 120,
            startVelocity: 21,
            ticks: 200,
          });
        }
      })(),
      new Promise((resolve) => {
        setTimeout(resolve, CONFETTI_MAX_MS);
      }),
      aborted,
    ]);
  } finally {
    removeAbortListener();
    try {
      instance.reset();
    } catch {
      // A canvas the browser already tore down has nothing left to reset.
    }
  }
  return true;
}

/**
 * The celebration surface. Mounted with the Timeline and toggled by the
 * celebration state, so the particle engine is only ever asked to draw during
 * the window in which the result is also visible.
 *
 * The element stays mounted for the life of the pane — remounting a canvas
 * mid-burst would cut the particles in flight — so `data-active` is what tells
 * a reader whether this surface is the one currently throwing confetti. Two
 * Timeline surfaces watching the same success is a real state of the product,
 * and exactly one of them owns the celebration.
 */
export function DeploymentTaskSuccessConfetti({
  active,
  loadConfetti,
}: {
  active: boolean;
  /** Test seam: swap the particle engine without touching the trigger rules. */
  loadConfetti?: TimelineConfettiLoader;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas == null) {
      return;
    }
    const controller = new AbortController();
    fireTimelineSuccessConfetti(canvas, loadConfetti, controller.signal).catch(
      () => undefined
    );
    return () => controller.abort();
  }, [active, loadConfetti]);

  return (
    <canvas
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 size-full"
      data-active={active ? "true" : "false"}
      data-slot="deployment-task-success-confetti"
      ref={canvasRef}
    />
  );
}
