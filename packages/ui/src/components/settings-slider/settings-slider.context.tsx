"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type {
  SettingsSliderValue,
  SettingsSliderValueAffix,
} from "./settings-slider.types";
import { clampScale } from "./settings-slider.utils";

interface SettingsSliderContextValue extends SettingsSliderValue {
  setValueFromRadix: (next: number[]) => void;
}

export interface SettingsSliderRootProps {
  children: ReactNode;
  defaultValue?: number;
  disabled?: boolean;
  displayValue?: number;
  formatBound?: (value: number) => ReactNode;
  max?: number;
  maxDecimals?: number;
  maxLabel?: ReactNode;
  min?: number;
  minLabel?: ReactNode;
  onValueChange?: (value: number) => void;
  step?: number;
  value?: number;
  valueFormat?: SettingsSliderValue["states"]["valueFormat"];
  valuePrefix?: SettingsSliderValueAffix;
  valueSuffix?: SettingsSliderValueAffix;
}

const SettingsSliderContext = createContext<SettingsSliderContextValue | null>(
  null
);

export function useSettingsSlider(
  component = "SettingsSlider"
): SettingsSliderValue {
  const ctx = useContext(SettingsSliderContext);
  if (!ctx) {
    throw new Error(`${component} must be used within SettingsSlider.Root`);
  }
  return { states: ctx.states };
}

export function useSettingsSliderContext(
  component: string
): SettingsSliderContextValue {
  const ctx = useContext(SettingsSliderContext);
  if (!ctx) {
    throw new Error(`${component} must be used within SettingsSlider.Root`);
  }
  return ctx;
}

export function SettingsSliderRoot({
  children,
  defaultValue = 0,
  disabled = false,
  displayValue: displayValueProp,
  formatBound,
  max: maxProp,
  maxDecimals = 1,
  maxLabel,
  min: minProp,
  minLabel,
  onValueChange,
  step = 0.1,
  value: valueProp,
  valueFormat,
  valuePrefix,
  valueSuffix,
}: SettingsSliderRootProps) {
  const min = minProp ?? 0;
  const max = maxProp ?? 100;
  const isControlled = valueProp !== undefined;
  const [uncontrolled, setUncontrolled] = useState(() =>
    clampScale(defaultValue, min, max)
  );

  const current = isControlled
    ? clampScale(valueProp as number, min, max)
    : uncontrolled;

  const displayValue =
    displayValueProp !== undefined && Number.isFinite(displayValueProp)
      ? displayValueProp
      : current;

  const setValueFromRadix = useCallback(
    (next: number[]) => {
      const n = next[0];
      if (n === undefined) {
        return;
      }
      const c = clampScale(n, min, max);
      if (!isControlled) {
        setUncontrolled(c);
      }
      onValueChange?.(c);
    },
    [isControlled, max, min, onValueChange]
  );

  const contextValue = useMemo(
    (): SettingsSliderContextValue => ({
      states: {
        current,
        disabled,
        displayValue,
        formatBound,
        max,
        maxDecimals,
        maxLabel,
        min,
        minLabel,
        step,
        valueFormat,
        valuePrefix,
        valueSuffix,
      },
      setValueFromRadix,
    }),
    [
      current,
      disabled,
      displayValue,
      formatBound,
      max,
      maxDecimals,
      maxLabel,
      min,
      minLabel,
      setValueFromRadix,
      step,
      valueFormat,
      valuePrefix,
      valueSuffix,
    ]
  );

  return (
    <SettingsSliderContext.Provider value={contextValue}>
      {children}
    </SettingsSliderContext.Provider>
  );
}
