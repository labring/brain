import type { Format } from "@number-flow/react";
import type { ReactNode } from "react";

export type SettingsSliderValueAffix = string | ((value: number) => string);

export interface SettingsSliderStates {
  current: number;
  disabled: boolean;
  displayValue: number;
  formatBound?: (value: number) => ReactNode;
  max: number;
  maxDecimals: number;
  maxLabel?: ReactNode;
  min: number;
  minLabel?: ReactNode;
  step: number;
  valueFormat?: Format;
  valuePrefix?: SettingsSliderValueAffix;
  valueSuffix?: SettingsSliderValueAffix;
}

export interface SettingsSliderValue {
  states: SettingsSliderStates;
}
