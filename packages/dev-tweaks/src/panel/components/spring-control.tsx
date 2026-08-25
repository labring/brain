/* eslint-disable react-hooks/refs -- ported panel render-update patterns kept structurally intact */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { DevTweaksStore, type SpringConfig } from "../store/dev-tweaks-store";
import { Folder } from "./folder";
import { SegmentedControl } from "./segmented-control";
import { Slider } from "./slider";
import { SpringVisualization } from "./spring-visualization";

interface SpringControlProps {
  label: string;
  onChange: (spring: SpringConfig) => void;
  panelId: string;
  path: string;
  spring: SpringConfig;
}

export function SpringControl({
  panelId,
  path,
  label,
  spring,
  onChange,
}: SpringControlProps) {
  const subscribe = useCallback(
    (callback: () => void) => DevTweaksStore.subscribe(panelId, callback),
    [panelId]
  );
  const getSnapshot = useCallback(
    () => DevTweaksStore.getSpringMode(panelId, path),
    [panelId, path]
  );
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const isSimpleMode = mode === "simple";

  // Cache per-mode values so switching back restores previous edits
  const cache = useRef<{
    simple: SpringConfig;
    advanced: SpringConfig;
  }>({
    simple:
      spring.visualDuration === undefined
        ? { type: "spring", visualDuration: 0.3, bounce: 0.2 }
        : spring,
    advanced:
      spring.stiffness === undefined
        ? { type: "spring", stiffness: 200, damping: 25, mass: 1 }
        : spring,
  });

  if (isSimpleMode) {
    cache.current.simple = spring;
  } else {
    cache.current.advanced = spring;
  }

  const handleModeChange = (newMode: "simple" | "advanced") => {
    DevTweaksStore.updateSpringMode(panelId, path, newMode);

    if (newMode === "simple") {
      onChange(cache.current.simple);
    } else {
      onChange(cache.current.advanced);
    }
  };

  const handleUpdate = (key: keyof SpringConfig, value: number) => {
    // When updating in simple mode, ensure physics props are removed
    if (isSimpleMode) {
      const { stiffness, damping, mass, ...rest } = spring;
      onChange({ ...rest, [key]: value });
    } else {
      // When updating in physics mode, ensure time-based props are removed
      const { visualDuration, bounce, ...rest } = spring;
      onChange({ ...rest, [key]: value });
    }
  };

  return (
    <Folder defaultOpen={true} title={label}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SpringVisualization isSimpleMode={isSimpleMode} spring={spring} />

        <div className="dev-tweaks-labeled-control">
          <span className="dev-tweaks-labeled-control-label">Type</span>
          <SegmentedControl
            onChange={handleModeChange}
            options={[
              { value: "simple" as const, label: "Time" },
              { value: "advanced" as const, label: "Physics" },
            ]}
            value={mode}
          />
        </div>

        {isSimpleMode ? (
          <>
            <Slider
              label="Duration"
              max={1}
              min={0.1}
              onChange={(v) => handleUpdate("visualDuration", v)}
              step={0.05}
              unit="s"
              value={spring.visualDuration ?? 0.3}
            />
            <Slider
              label="Bounce"
              max={1}
              min={0}
              onChange={(v) => handleUpdate("bounce", v)}
              step={0.05}
              value={spring.bounce ?? 0.2}
            />
          </>
        ) : (
          <>
            <Slider
              label="Stiffness"
              max={1000}
              min={1}
              onChange={(v) => handleUpdate("stiffness", v)}
              step={10}
              value={spring.stiffness ?? 400}
            />
            <Slider
              label="Damping"
              max={100}
              min={1}
              onChange={(v) => handleUpdate("damping", v)}
              step={1}
              value={spring.damping ?? 17}
            />
            <Slider
              label="Mass"
              max={10}
              min={0.1}
              onChange={(v) => handleUpdate("mass", v)}
              step={0.1}
              value={spring.mass ?? 1}
            />
          </>
        )}
      </div>
    </Folder>
  );
}
