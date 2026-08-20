// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
import type { DialKitPersistOptions } from '../store/DialStore';
import type { TimelineMeta, TimelineTransport } from '../store/TimelineStore';
import { loopSpan } from '../store/TimelineStore';
import {
  computeClipState,
  type DialTimelineValues,
  type ParsedTimeline,
  type TimelineClipStatic,
  type TimelineConfig,
} from '../timeline-core';

export interface DialTimelineOptions {
  id?: string;
  persist?: DialKitPersistOptions;
  /** Start playing on mount. Defaults to true. */
  autoplay?: boolean;
  /**
   * Loop when the playhead reaches the end. `true` restarts the whole
   * timeline; `{ from }` wraps back to that time instead, so clips before it
   * play once and looping clips keep cycling forever. Defaults to false.
   */
  loop?: boolean | { from: number };
}

export type TimelineActions = {
  play: () => void;
  pause: () => void;
  replay: () => void;
  seek: (time: number) => void;
};

/** One resolution of the public loop option, shared by every adapter. */
export function resolveTimelineLoop(
  loop: DialTimelineOptions['loop']
): { enabled: boolean; start: number } {
  if (typeof loop === 'object' && loop !== null) {
    return {
      enabled: true,
      start: Number.isFinite(loop.from) ? Math.max(0, loop.from) : 0,
    };
  }
  return { enabled: Boolean(loop), start: 0 };
}

export function buildTimelineMeta(
  id: string,
  name: string,
  duration: number,
  parsed: ParsedTimeline,
  loop: DialTimelineOptions['loop']
): TimelineMeta {
  const resolvedLoop = resolveTimelineLoop(loop);
  return {
    id,
    name,
    duration,
    loop: resolvedLoop.enabled,
    loopStart: resolvedLoop.start,
    clips: parsed.clips,
  };
}

/**
 * Framework-neutral frame pass. Adapters only own lifecycle and reactivity;
 * the value shape and loop-cycle math stay identical everywhere.
 */
export function buildTimelineValues<T extends TimelineConfig>(
  staticClips: TimelineClipStatic[],
  transport: TimelineTransport,
  timelineDuration: number,
  loopStart: number,
  actions: TimelineActions
): DialTimelineValues<T> {
  const result: Record<string, unknown> = {
    time: transport.time,
    playing: transport.playing,
    duration: timelineDuration,
    ...actions,
  };

  const span = loopSpan(transport.duration, loopStart);
  const cycleTime = (span > 0 ? transport.wraps * span : 0) + transport.time;
  for (const clip of staticClips) {
    const state = computeClipState(clip, transport.time, cycleTime);
    if (clip.group) {
      const bucket = (result[clip.group] ??= {}) as Record<string, unknown>;
      bucket[clip.childKey] = state;
    } else {
      result[clip.key] = state;
    }
  }

  return result as DialTimelineValues<T>;
}
