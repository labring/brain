// biome-ignore lint/performance/noBarrelFile: DialKit public API surface
export { buildCopyInstruction } from "../copy-instruction";
export { isDevDefault } from "../env";
export type {
  TimelineClipMeta,
  TimelineClipTrackMeta,
  TimelineMeta,
  TimelineTransport,
} from "../store/timeline-store";
export {
  foldLoopTime,
  loopSpan,
  TIMELINE_CLIP_COLORS,
  TimelineStore,
} from "../store/timeline-store";
export { TimelineUiStore } from "../store/timeline-ui-store";
export type {
  DialTimelineValues,
  ParsedTimeline,
  TimelineClipConfig,
  TimelineClipCss,
  TimelineClipLoop,
  TimelineClipStatic,
  TimelineClipValues,
  TimelineConfig,
  TimelineGroupConfig,
  TimelineGroupValues,
  TimelinePropConfig,
  TimelinePropStepConfig,
  TimelineStaticState,
  TimelineStepConfig,
  TimelineStepStatic,
  TimelineStepValues,
  TimelineTrackStatic,
} from "../timeline-core";
export {
  clampClipMove,
  clampClipResizeEnd,
  clampClipResizeStart,
  clampStepResize,
  clampTrackDelay,
  computeClipState,
  computeClipStaticFromValues,
  computeStaticClips,
  computeStaticTimeline,
  formatClock,
  formatSeconds,
  formatStepLabel,
  normalizeTimelineValuesForCopy,
  parseTimelineConfig,
  TIMELINE_MIN_CLIP_DURATION,
  timelinePopoverDisplayValues,
  transitionToCss,
} from "../timeline-core";
export { clamp } from "../transition-math";
export type { DialTimelineOptions, TimelineActions } from "./adapter";
export {
  buildTimelineMeta,
  buildTimelineValues,
  resolveTimelineLoop,
} from "./adapter";
