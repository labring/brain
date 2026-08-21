/* eslint-disable react-hooks/refs -- ported panel render-update patterns kept structurally intact */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  DevTweaksStore,
  type EasingConfig,
  type SpringConfig,
  type TransitionConfig,
} from "../store/dev-tweaks-store";
import { EasingVisualization } from "./easing-visualization";
import { Folder } from "./folder";
import { SegmentedControl } from "./segmented-control";
import { Slider } from "./slider";
import { SpringVisualization } from "./spring-visualization";

interface TransitionControlProps {
  /** Route duration edits through an external owner while keeping this control's layout. */
  durationControl?: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
  };
  /** Hide duration sliders when something else owns the duration (e.g. a timeline clip bar). */
  hideDuration?: boolean;
  label: string;
  onChange: (value: TransitionConfig) => void;
  panelId: string;
  path: string;
  value: TransitionConfig;
}

type CurveMode = "easing" | "simple" | "advanced";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
export function TransitionControl({
  panelId,
  path,
  label,
  value,
  onChange,
  hideDuration = false,
  durationControl,
}: TransitionControlProps) {
  const subscribe = useCallback(
    (callback: () => void) => DevTweaksStore.subscribe(panelId, callback),
    [panelId]
  );
  const getSnapshot = useCallback(
    () => DevTweaksStore.getTransitionMode(panelId, path),
    [panelId, path]
  );
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const isEasing = mode === "easing";
  const isSimpleSpring = mode === "simple";

  // Cache per-mode values so switching back restores previous edits
  const cache = useRef<{
    easing: EasingConfig;
    simple: SpringConfig;
    advanced: SpringConfig;
  }>({
    easing:
      value.type === "easing"
        ? value
        : { type: "easing", duration: 0.3, ease: [1, -0.4, 0.5, 1] },
    simple:
      value.type === "spring" && value.visualDuration !== undefined
        ? value
        : { type: "spring", visualDuration: 0.3, bounce: 0.2 },
    advanced:
      value.type === "spring" && value.stiffness !== undefined
        ? value
        : { type: "spring", stiffness: 200, damping: 25, mass: 1 },
  });

  // Keep cache up to date with current edits
  if (isEasing && value.type === "easing") {
    cache.current.easing = value;
  } else if (isSimpleSpring && value.type === "spring") {
    cache.current.simple = value;
  } else if (mode === "advanced" && value.type === "spring") {
    cache.current.advanced = value;
  }

  const spring: SpringConfig =
    value.type === "spring" ? value : cache.current.simple;
  const easing: EasingConfig =
    value.type === "easing" ? value : cache.current.easing;

  const handleModeChange = (newMode: CurveMode) => {
    DevTweaksStore.updateTransitionMode(panelId, path, newMode);

    if (newMode === "easing") {
      onChange(cache.current.easing);
    } else if (newMode === "simple") {
      onChange(cache.current.simple);
    } else {
      onChange(cache.current.advanced);
    }
  };

  const handleSpringUpdate = (key: keyof SpringConfig, val: number) => {
    if (isSimpleSpring) {
      const { stiffness, damping, mass, ...rest } = spring;
      onChange({ ...rest, [key]: val });
    } else {
      const { visualDuration, bounce, ...rest } = spring;
      onChange({ ...rest, [key]: val });
    }
  };

  const updateEase = (index: number, val: number) => {
    const newEase = [...easing.ease] as [number, number, number, number];
    newEase[index] = val;
    onChange({ ...easing, ease: newEase });
  };

  const durationSlider =
    !hideDuration && (isEasing || isSimpleSpring) ? (
      <Slider
        label="Duration"
        max={durationControl?.max ?? (isEasing ? 2 : 1)}
        min={durationControl?.min ?? 0.1}
        onChange={
          durationControl?.onChange ??
          ((next) => {
            if (isEasing) {
              onChange({ ...easing, duration: next });
            } else {
              handleSpringUpdate("visualDuration", next);
            }
          })
        }
        step={durationControl?.step ?? 0.05}
        unit="s"
        value={
          durationControl?.value ??
          (isEasing ? easing.duration : (spring.visualDuration ?? 0.3))
        }
      />
    ) : null;

  const springSliders = isSimpleSpring ? (
    <Slider
      label="Bounce"
      max={1}
      min={0}
      onChange={(v) => handleSpringUpdate("bounce", v)}
      step={0.05}
      value={spring.bounce ?? 0.2}
    />
  ) : (
    <>
      <Slider
        label="Stiffness"
        max={1000}
        min={1}
        onChange={(v) => handleSpringUpdate("stiffness", v)}
        step={10}
        value={spring.stiffness ?? 400}
      />
      <Slider
        label="Damping"
        max={100}
        min={1}
        onChange={(v) => handleSpringUpdate("damping", v)}
        step={1}
        value={spring.damping ?? 17}
      />
      <Slider
        label="Mass"
        max={10}
        min={0.1}
        onChange={(v) => handleSpringUpdate("mass", v)}
        step={0.1}
        value={spring.mass ?? 1}
      />
    </>
  );

  return (
    <Folder defaultOpen={true} title={label}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {isEasing ? (
          <EasingVisualization easing={easing} />
        ) : (
          <SpringVisualization isSimpleMode={isSimpleSpring} spring={spring} />
        )}

        <div className="dev-tweaks-labeled-control">
          <span className="dev-tweaks-labeled-control-label">Type</span>
          <SegmentedControl
            onChange={handleModeChange}
            options={[
              { value: "easing" as const, label: "Easing" },
              { value: "simple" as const, label: "Time" },
              { value: "advanced" as const, label: "Physics" },
            ]}
            value={mode}
          />
        </div>

        {isEasing ? (
          <>
            <Slider
              label="x1"
              max={1}
              min={0}
              onChange={(v) => updateEase(0, v)}
              step={0.01}
              value={easing.ease[0]}
            />
            <Slider
              label="y1"
              max={2}
              min={-1}
              onChange={(v) => updateEase(1, v)}
              step={0.01}
              value={easing.ease[1]}
            />
            <Slider
              label="x2"
              max={1}
              min={0}
              onChange={(v) => updateEase(2, v)}
              step={0.01}
              value={easing.ease[2]}
            />
            <Slider
              label="y2"
              max={2}
              min={-1}
              onChange={(v) => updateEase(3, v)}
              step={0.01}
              value={easing.ease[3]}
            />
            <EaseTextInput
              ease={easing.ease}
              onChange={(newEase) => onChange({ ...easing, ease: newEase })}
            />
          </>
        ) : (
          springSliders
        )}
        {durationSlider}
      </div>
    </Folder>
  );
}

function formatEase(ease: [number, number, number, number]): string {
  return ease.map((v) => Number.parseFloat(v.toFixed(2))).join(", ");
}

function parseEase(str: string): [number, number, number, number] | null {
  const parts = str.split(",").map((s) => Number.parseFloat(s.trim()));
  if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
    return parts as [number, number, number, number];
  }
  return null;
}

function EaseTextInput({
  ease,
  onChange,
}: {
  ease: [number, number, number, number];
  onChange: (ease: [number, number, number, number]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const handleFocus = () => {
    setDraft(formatEase(ease));
    setEditing(true);
  };

  const handleBlur = () => {
    const parsed = parseEase(draft);
    if (parsed) {
      onChange(parsed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="dev-tweaks-labeled-control">
      <span className="dev-tweaks-labeled-control-label">Ease</span>
      <input
        className="dev-tweaks-text-input"
        onBlur={handleBlur}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        type="text"
        value={editing ? draft : formatEase(ease)}
      />
    </div>
  );
}
