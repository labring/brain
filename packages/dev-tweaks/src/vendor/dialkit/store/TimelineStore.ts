// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
// Playback transport + registry for DialKit timelines.
// Clip values (at/duration/from/to) live in DialStore under the timeline's
// panel id — this store only owns time: the clock, play state, and the
// track/clip structure the dock UI renders.

export type TimelineClipTrackMeta = {
  prop: string;
  /** Step folder keys when the track is a sequence. */
  stepKeys?: string[];
};

export type TimelineClipMeta = {
  key: string; // config path; also the DialStore path prefix, e.g. "cardEnter" or "circle.path"
  label: string;
  color: string;
  /** Code-defined playback behavior; intentionally not exposed as a dial. */
  loop: 'off' | 'repeat';
  /** Group key when the clip lives inside a nested layer, e.g. "circle". */
  group?: string;
  /** Step folder keys for sequence clips, e.g. ["step1", "step2"]. */
  stepKeys?: string[];
  /** Independent property tracks of a props clip — full rows when expanded. */
  tracks?: TimelineClipTrackMeta[];
};

export type TimelineMeta = {
  id: string; // same id as the DialStore panel
  name: string;
  duration: number; // seconds
  loop: boolean;
  /** Loop wraps back to this time, not 0 — clips before it play once
   * (intro-then-idle). 0 loops the whole timeline. */
  loopStart: number;
  clips: TimelineClipMeta[]; // one row each
};

export type TimelineTransport = {
  time: number;
  playing: boolean;
  duration: number;
  /** Completed loop passes — keeps looping clips phase-continuous across
   * timeline wraps. Reset by seek/replay so scrubbing stays deterministic. */
  wraps: number;
};

type Listener = () => void;

/** Length of the repeating span — the whole timeline unless a loop region
 * narrows it. Degenerate regions (start ≥ duration) fall back to the whole
 * timeline so a bad `from` never stalls the clock. */
export function loopSpan(duration: number, loopStart: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(loopStart)) loopStart = 0;
  const start = Math.min(Math.max(0, loopStart), duration);
  return duration - start > 0 ? duration - start : duration;
}

/** Folds an over-run playhead back into the loop region, reporting how many
 * spans were crossed so continuous time (wraps × span + time) never jumps. */
export function foldLoopTime(
  time: number,
  duration: number,
  loopStart = 0
): { time: number; wraps: number } {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return { time: 0, wraps: 0 };
  }
  if (time < duration) return { time, wraps: 0 };
  const span = loopSpan(duration, loopStart);
  const base = duration - span;
  const over = time - base;
  return { time: base + (over % span), wraps: Math.floor(over / span) };
}

export const TIMELINE_CLIP_COLORS = [
  '#E8E8E8', // neutral white — slightly off-white so the pure-white selection ring still reads
];

const EMPTY_TRANSPORT: TimelineTransport = Object.freeze({ time: 0, playing: false, duration: 0, wraps: 0 });

class TimelineStoreClass {
  private timelines: Map<string, TimelineMeta> = new Map();
  private transports: Map<string, TimelineTransport> = new Map();
  private listeners: Map<string, Set<Listener>> = new Map();
  private globalListeners: Set<Listener> = new Set();
  private registrationCounts: Map<string, number> = new Map();
  private listCache: TimelineMeta[] | null = null;
  private rafId: number | null = null;
  private lastTick = 0;

  register(meta: TimelineMeta, options: { autoplay: boolean }): void {
    const existing = this.timelines.get(meta.id);
    if (existing && existing.name !== meta.name) {
      console.warn(
        `[dialkit] Timeline id "${meta.id}" is already registered by "${existing.name}"; ` +
        `"${meta.name}" will share and overwrite that transport.`
      );
    }
    this.registrationCounts.set(meta.id, (this.registrationCounts.get(meta.id) ?? 0) + 1);
    this.applyMeta(meta, options.autoplay);
  }

  update(meta: TimelineMeta): void {
    if (!this.timelines.has(meta.id)) return;
    this.applyMeta(meta, false);
  }

  unregister(id: string): void {
    const nextCount = (this.registrationCounts.get(id) ?? 1) - 1;
    if (nextCount > 0) {
      this.registrationCounts.set(id, nextCount);
      return;
    }

    this.registrationCounts.delete(id);
    this.timelines.delete(id);
    this.transports.delete(id);
    // Keep listener sets: subscribers (e.g. a mounted dock) may outlive the
    // registration — HMR tears down and re-registers the same id, and their
    // subscriptions must survive it. Cleanup happens via unsubscribe closures.
    if (this.listeners.get(id)?.size === 0) this.listeners.delete(id);
    this.listCache = null;
    this.notifyGlobal();
  }

  play(id: string): void {
    const transport = this.transports.get(id);
    if (!transport || transport.duration <= 0 || transport.playing) return;
    // Play from the top when the playhead is parked at the end
    const restart = transport.time >= transport.duration;
    this.transports.set(id, {
      ...transport,
      time: restart ? 0 : transport.time,
      wraps: restart ? 0 : transport.wraps,
      playing: true,
    });
    this.notify(id);
    this.ensureLoop();
  }

  pause(id: string): void {
    const transport = this.transports.get(id);
    if (!transport || !transport.playing) return;
    this.transports.set(id, { ...transport, playing: false });
    this.notify(id);
  }

  replay(id: string): void {
    const transport = this.transports.get(id);
    if (!transport || transport.duration <= 0) return;
    this.transports.set(id, { ...transport, time: 0, wraps: 0, playing: true });
    this.notify(id);
    this.ensureLoop();
  }

  seek(id: string, time: number): void {
    const transport = this.transports.get(id);
    if (!transport || !Number.isFinite(time)) return;
    const clamped = Math.min(transport.duration, Math.max(0, time));
    // Scrubbing pins the deterministic first-pass state
    this.transports.set(id, { ...transport, time: clamped, wraps: 0 });
    this.notify(id);
  }

  getTransport(id: string): TimelineTransport {
    return this.transports.get(id) ?? EMPTY_TRANSPORT;
  }

  getTimeline(id: string): TimelineMeta | undefined {
    return this.timelines.get(id);
  }

  getTimelines(): TimelineMeta[] {
    if (!this.listCache) {
      this.listCache = Array.from(this.timelines.values());
    }
    return this.listCache;
  }

  subscribe(id: string, listener: Listener): () => void {
    if (!this.listeners.has(id)) {
      this.listeners.set(id, new Set());
    }
    this.listeners.get(id)!.add(listener);
    return () => {
      const listeners = this.listeners.get(id);
      listeners?.delete(listener);
      if (listeners?.size === 0 && !this.timelines.has(id)) {
        this.listeners.delete(id);
      }
    };
  }

  subscribeGlobal(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private applyMeta(meta: TimelineMeta, autoplay: boolean): void {
    const duration = Number.isFinite(meta.duration) ? Math.max(0, meta.duration) : 0;
    const loopStart = Number.isFinite(meta.loopStart)
      ? Math.min(duration, Math.max(0, meta.loopStart))
      : 0;
    const safeMeta = { ...meta, duration, loopStart };
    this.timelines.set(meta.id, safeMeta);

    const existing = this.transports.get(meta.id);
    if (existing) {
      // Structure changed or remounted — keep the playhead, clamp to the new length
      this.transports.set(meta.id, {
        time: Math.min(existing.time, duration),
        playing: duration > 0 && existing.playing,
        duration,
        wraps: existing.wraps,
      });
    } else {
      const playing = duration > 0 && autoplay;
      this.transports.set(meta.id, { time: 0, playing, duration, wraps: 0 });
      if (playing) this.ensureLoop();
    }

    this.listCache = null;
    this.notify(meta.id);
    this.notifyGlobal();
  }

  private ensureLoop(): void {
    if (this.rafId !== null || typeof window === 'undefined') return;
    this.lastTick = performance.now();
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    // Advance by wall time. A backgrounded tab lands at the state it would
    // have reached, rather than silently slowing the animation on return.
    const dt = Math.max(0, (now - this.lastTick) / 1000);
    this.lastTick = now;

    let anyPlaying = false;
    for (const [id, transport] of this.transports) {
      if (!transport.playing) continue;

      const meta = this.timelines.get(id);
      const duration = meta?.duration ?? transport.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        this.transports.set(id, { time: 0, playing: false, duration: 0, wraps: 0 });
        this.notify(id);
        continue;
      }
      let time = transport.time + dt;
      let playing = true;
      let wraps = transport.wraps;

      if (time >= duration) {
        if (meta?.loop) {
          const folded = foldLoopTime(time, duration, meta.loopStart);
          time = folded.time;
          wraps += folded.wraps;
        } else {
          time = duration;
          playing = false;
        }
      }

      this.transports.set(id, { time, playing, duration, wraps });
      if (playing) anyPlaying = true;
      this.notify(id);
    }

    this.rafId = anyPlaying ? window.requestAnimationFrame(this.tick) : null;
  };

  private notify(id: string): void {
    this.listeners.get(id)?.forEach((fn) => fn());
  }

  private notifyGlobal(): void {
    this.globalListeners.forEach((fn) => fn());
  }
}

// PURE lets bundlers drop the timeline entirely for panel-only users.
export const TimelineStore = /* @__PURE__ */ new TimelineStoreClass();
