import { useContext } from "react";
import {
  type ControlMeta,
  DevTweaksStore,
  type DevTweaksValue,
  type SpringConfig,
  type TransitionConfig,
} from "../store/dev-tweaks-store";
import { ColorControl } from "./color-control";
import { Folder } from "./folder";
import { SelectControl } from "./select-control";
import { ShortcutContext } from "./shortcut-listener";
import { Slider } from "./slider";
import { SpringControl } from "./spring-control";
import { TextControl } from "./text-control";
import { Toggle } from "./toggle";
import { TransitionControl } from "./transition-control";

interface ControlRendererProps {
  controls: ControlMeta[];
  panelId: string;
  /** Optional timeline-owned duration rendered inside the transition editor. */
  transitionDuration?: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
  };
  values: Record<string, DevTweaksValue>;
}

// Renders a ControlMeta tree with the standard panel controls.
// Shared by the panel and the timeline clip popover.
export function ControlRenderer({
  panelId,
  controls,
  values,
  transitionDuration,
}: ControlRendererProps) {
  const shortcutCtx = useContext(ShortcutContext);

  const renderControl = (control: ControlMeta) => {
    const value = values[control.path];

    switch (control.type) {
      case "slider":
        return (
          <Slider
            key={control.path}
            label={control.label}
            max={control.max}
            min={control.min}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            shortcut={control.shortcut}
            shortcutActive={
              shortcutCtx.activePanelId === panelId &&
              shortcutCtx.activePath === control.path
            }
            step={control.step}
            value={value as number}
          />
        );

      case "toggle":
        return (
          <Toggle
            checked={value as boolean}
            key={control.path}
            label={control.label}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            shortcut={control.shortcut}
            shortcutActive={
              shortcutCtx.activePanelId === panelId &&
              shortcutCtx.activePath === control.path
            }
          />
        );

      case "spring":
        return (
          <SpringControl
            key={control.path}
            label={control.label}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            panelId={panelId}
            path={control.path}
            spring={value as SpringConfig}
          />
        );

      case "transition":
        return (
          <TransitionControl
            durationControl={transitionDuration}
            key={control.path}
            label={control.label}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            panelId={panelId}
            path={control.path}
            value={value as TransitionConfig}
          />
        );

      case "folder":
        return (
          <Folder
            defaultOpen={control.defaultOpen ?? true}
            key={control.path}
            title={control.label}
          >
            {control.children?.map(renderControl)}
          </Folder>
        );

      case "text":
        return (
          <TextControl
            key={control.path}
            label={control.label}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            placeholder={control.placeholder}
            value={value as string}
          />
        );

      case "select":
        return (
          <SelectControl
            key={control.path}
            label={control.label}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            options={control.options ?? []}
            value={value as string}
          />
        );

      case "color":
        return (
          <ColorControl
            key={control.path}
            label={control.label}
            onChange={(v) =>
              DevTweaksStore.updateValue(panelId, control.path, v)
            }
            value={value as string}
          />
        );

      case "action":
        return (
          <button
            className="dev-tweaks-button"
            key={control.path}
            onClick={() => DevTweaksStore.triggerAction(panelId, control.path)}
            type="button"
          >
            {control.label}
          </button>
        );

      default:
        return null;
    }
  };

  return <>{controls.map(renderControl)}</>;
}
