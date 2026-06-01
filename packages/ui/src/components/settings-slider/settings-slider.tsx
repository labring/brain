"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  SettingsSliderRoot,
  type SettingsSliderRootProps,
  useSettingsSlider as useSettingsSliderBound,
} from "./settings-slider.context";
import {
  SettingsSliderGroup,
  SettingsSliderHeader,
  SettingsSliderLabel,
  SettingsSliderStack,
} from "./settings-slider.layout";
import {
  SettingsSliderBounds,
  SettingsSliderControl,
  SettingsSliderRange,
  SettingsSliderThumb,
  SettingsSliderTrack,
  SettingsSliderValue,
} from "./settings-slider.parts";

// biome-ignore lint/performance/noBarrelFile: compound hook/type re-exports for the component API.
export { useSettingsSlider } from "./settings-slider.context";
export type {
  SettingsSliderStates,
  SettingsSliderValue,
  SettingsSliderValueAffix,
} from "./settings-slider.types";

export interface SettingsSliderProps
  extends Omit<SettingsSliderRootProps, "children"> {
  ariaLabel: string;
  className?: string;
  icon?: LucideIcon;
  label: ReactNode;
}

function SettingsSliderBase({
  ariaLabel,
  className,
  icon: Icon,
  label,
  ...rootProps
}: SettingsSliderProps) {
  return (
    <SettingsSliderRoot {...rootProps}>
      <SettingsSliderStack className={className}>
        <SettingsSliderHeader>
          <SettingsSliderGroup>
            {Icon == null ? null : (
              <Icon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            <SettingsSliderLabel>{label}</SettingsSliderLabel>
          </SettingsSliderGroup>
          <SettingsSliderValue />
        </SettingsSliderHeader>
        <SettingsSliderControl aria-label={ariaLabel}>
          <SettingsSliderTrack>
            <SettingsSliderRange />
          </SettingsSliderTrack>
          <SettingsSliderThumb />
        </SettingsSliderControl>
        <SettingsSliderBounds />
      </SettingsSliderStack>
    </SettingsSliderRoot>
  );
}

export const SettingsSlider = Object.assign(SettingsSliderBase, {
  Bounds: SettingsSliderBounds,
  Control: SettingsSliderControl,
  Group: SettingsSliderGroup,
  Header: SettingsSliderHeader,
  Label: SettingsSliderLabel,
  Range: SettingsSliderRange,
  Root: SettingsSliderRoot,
  Stack: SettingsSliderStack,
  Thumb: SettingsSliderThumb,
  Track: SettingsSliderTrack,
  Value: SettingsSliderValue,
  useSettingsSlider: useSettingsSliderBound,
});
