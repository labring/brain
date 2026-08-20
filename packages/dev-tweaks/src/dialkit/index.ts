// Main hook

// biome-ignore lint/performance/noBarrelFile: DialKit public API surface
export { ButtonGroup } from "./components/button-group";
export { ColorControl } from "./components/color-control";
// Individual components (for advanced usage)
export { ControlRenderer } from "./components/control-renderer";
export type { DialMode, DialPosition, DialTheme } from "./components/dial-root";
// Root component (user mounts once)
export { DialRoot } from "./components/dial-root";
export { EasingVisualization } from "./components/easing-visualization";
export { Folder } from "./components/folder";
export { PresetManager } from "./components/preset-manager";
export { SelectControl } from "./components/select-control";
export { ShortcutsMenu } from "./components/shortcuts-menu";
export { Slider } from "./components/slider";
export { SpringControl } from "./components/spring-control";
export { SpringVisualization } from "./components/spring-visualization";
export { TextControl } from "./components/text-control";
export type { DialTimelineProps } from "./components/timeline/dial-timeline";
export { DialTimeline } from "./components/timeline/dial-timeline";
export { Toggle } from "./components/toggle";
export { TransitionControl } from "./components/transition-control";
export type { DialKitController, UseDialOptions } from "./hooks/use-dial-kit";
export { useDialKit, useDialKitController } from "./hooks/use-dial-kit";
export type {
  DialTimelineValues,
  TimelineClipConfig,
  TimelineClipCss,
  TimelineClipLoop,
  TimelineClipValues,
  TimelineConfig,
  TimelineGroupConfig,
  TimelineGroupValues,
  TimelinePropConfig,
  TimelinePropStepConfig,
  TimelineStepConfig,
  TimelineStepValues,
  UseDialTimelineOptions,
} from "./hooks/use-dial-timeline";
// Timeline (prototype)
export { useDialTimeline } from "./hooks/use-dial-timeline";
export type {
  ActionConfig,
  ColorConfig,
  ControlMeta,
  DialConfig,
  DialKitPersistOptions,
  DialKitValueUpdates,
  DialValue,
  EasingConfig,
  PanelConfig,
  Preset,
  ResolvedValues,
  SelectConfig,
  ShortcutConfig,
  ShortcutInteraction,
  ShortcutMode,
  SpringConfig,
  TextConfig,
  TransitionConfig,
} from "./store/dial-store";
// Store (for advanced usage)
export { DialStore } from "./store/dial-store";
export type {
  TimelineClipMeta,
  TimelineClipTrackMeta,
  TimelineMeta,
  TimelineTransport,
} from "./store/timeline-store";
export { TimelineStore } from "./store/timeline-store";
export { formatClock } from "./timeline-core";
