"use client";

import { NumberField } from "@base-ui/react/number-field";
import { Slider } from "@base-ui/react/slider";
import { Switch } from "@base-ui/react/switch";

import type {
  DevTweaksColorDef,
  DevTweaksControlDef,
  DevTweaksNumberDef,
  DevTweaksSelectDef,
  DevTweaksSliderDef,
  DevTweaksSwitchDef,
  DevTweaksValue,
} from "../types";
import { IconChevron, IconReset } from "./icons";

interface ControlInputProps<D extends DevTweaksControlDef> {
  def: D;
  onChange: (value: DevTweaksValue) => void;
  value: DevTweaksValue;
}

function SliderControl({
  def,
  onChange,
  value,
}: ControlInputProps<DevTweaksSliderDef>) {
  const current = typeof value === "number" ? value : def.value;
  return (
    <>
      <Slider.Root
        className="dtp-slider"
        max={def.max}
        min={def.min}
        onValueChange={(next) => {
          if (typeof next === "number") {
            onChange(next);
          }
        }}
        step={def.step ?? 1}
        value={current}
      >
        <Slider.Control className="dtp-slider-control">
          <Slider.Track className="dtp-slider-track">
            <Slider.Indicator className="dtp-slider-indicator" />
            <Slider.Thumb aria-label={def.label} className="dtp-slider-thumb" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span className="dtp-val">
        {current}
        {def.unit ? <i>{def.unit}</i> : null}
      </span>
    </>
  );
}

function NumberControl({
  def,
  onChange,
  value,
}: ControlInputProps<DevTweaksNumberDef>) {
  const current = typeof value === "number" ? value : def.value;
  return (
    <NumberField.Root
      className="dtp-numwrap"
      max={def.max}
      min={def.min}
      onValueChange={(next) => {
        if (typeof next === "number" && Number.isFinite(next)) {
          onChange(next);
        }
      }}
      step={def.step ?? 1}
      value={current}
    >
      <NumberField.Input aria-label={def.label} className="dtp-num" />
      {def.unit ? (
        <NumberField.ScrubArea className="dtp-scrub">
          <span className="dtp-unit">{def.unit}</span>
        </NumberField.ScrubArea>
      ) : null}
    </NumberField.Root>
  );
}

function SwitchControl({
  def,
  onChange,
  value,
}: ControlInputProps<DevTweaksSwitchDef>) {
  const current = typeof value === "boolean" ? value : def.value;
  return (
    <Switch.Root
      aria-label={def.label}
      checked={current}
      className="dtp-switch"
      onCheckedChange={(checked) => onChange(checked)}
    >
      <Switch.Thumb className="dtp-knob" />
    </Switch.Root>
  );
}

function SelectControl({
  def,
  onChange,
  value,
}: ControlInputProps<DevTweaksSelectDef>) {
  const current = typeof value === "string" ? value : def.value;
  return (
    <span className="dtp-selectwrap">
      <select
        aria-label={def.label}
        className="dtp-select"
        onChange={(event) => onChange(event.target.value)}
        value={current}
      >
        {def.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <IconChevron size={10} />
    </span>
  );
}

function ColorControl({
  def,
  onChange,
  value,
}: ControlInputProps<DevTweaksColorDef>) {
  const current = typeof value === "string" ? value : def.value;
  return (
    <span className="dtp-colorwrap">
      <span className="dtp-swatch" style={{ background: current }}>
        <input
          aria-label={def.label}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={current}
        />
      </span>
      <span className="dtp-hex">{current}</span>
    </span>
  );
}

function ControlInput({
  def,
  onChange,
  value,
}: ControlInputProps<DevTweaksControlDef>) {
  switch (def.type) {
    case "slider":
      return <SliderControl def={def} onChange={onChange} value={value} />;
    case "number":
      return <NumberControl def={def} onChange={onChange} value={value} />;
    case "switch":
      return <SwitchControl def={def} onChange={onChange} value={value} />;
    case "select":
      return <SelectControl def={def} onChange={onChange} value={value} />;
    case "color":
      return <ColorControl def={def} onChange={onChange} value={value} />;
    default:
      return null;
  }
}

export interface ControlRowProps {
  def: DevTweaksControlDef;
  onChange: (value: DevTweaksValue) => void;
  onReset: () => void;
  overridden: boolean;
  value: DevTweaksValue;
}

/** Shared 28px row shell: label column, control, hover-revealed reset. */
export function ControlRow({
  def,
  onChange,
  onReset,
  overridden,
  value,
}: ControlRowProps) {
  return (
    <div className="dtp-row" data-ov={overridden ? "true" : undefined}>
      <span className="dtp-label" title={def.label}>
        {overridden ? <span className="dtp-dot" /> : null}
        {def.label}
      </span>
      <ControlInput def={def} onChange={onChange} value={value} />
      {overridden ? (
        <button
          aria-label={`Reset ${def.label}`}
          className="dtp-reset"
          onClick={onReset}
          type="button"
        >
          <IconReset />
        </button>
      ) : null}
    </div>
  );
}
