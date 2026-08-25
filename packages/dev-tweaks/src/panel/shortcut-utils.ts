// Shared shortcut utilities — single source of truth across all framework adapters.

import type { ControlMeta, ShortcutConfig } from "./store/dev-tweaks-store";
import { DevTweaksStore } from "./store/dev-tweaks-store";

// ── Math helpers ──

export function decimalsForStep(step: number): number {
  const s = step.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

export function roundValue(val: number, step: number): number {
  const raw = Math.round(val / step) * step;
  return Number.parseFloat(raw.toFixed(decimalsForStep(step)));
}

export function getEffectiveStep(
  control: ControlMeta,
  shortcut: ShortcutConfig
): number {
  const min = control.min ?? 0;
  const max = control.max ?? 1;
  const range = max - min;
  const mode = shortcut.mode ?? "normal";
  if (mode === "fine") {
    return range * 0.01;
  }
  if (mode === "coarse") {
    return range * 0.1;
  }
  return control.step ?? 1;
}

export function applySliderDelta(
  panelId: string,
  path: string,
  control: ControlMeta,
  effectiveStep: number,
  direction: number
): void {
  const currentValue = DevTweaksStore.getValue(panelId, path) as number;
  const min = control.min ?? 0;
  const max = control.max ?? 1;
  const newValue = Math.max(
    min,
    Math.min(max, currentValue + direction * effectiveStep)
  );
  DevTweaksStore.updateValue(
    panelId,
    path,
    roundValue(newValue, effectiveStep)
  );
}

export function snapToDecile(
  rawValue: number,
  min: number,
  max: number
): number {
  const normalized = (rawValue - min) / (max - min);
  const nearest = Math.round(normalized * 10) / 10;
  if (Math.abs(normalized - nearest) <= 0.031_25) {
    return min + nearest * (max - min);
  }
  return rawValue;
}

// ── DOM helpers ──

export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return true;
  }
  if ((el as HTMLElement).contentEditable === "true") {
    return true;
  }
  return false;
}

export function getActiveModifier(
  e: KeyboardEvent | WheelEvent | MouseEvent
): "alt" | "shift" | "meta" | undefined {
  if (e.altKey) {
    return "alt";
  }
  if (e.shiftKey) {
    return "shift";
  }
  if (e.metaKey) {
    return "meta";
  }
  return undefined;
}

export function findControl(
  controls: ControlMeta[],
  path: string
): ControlMeta | null {
  for (const control of controls) {
    if (control.path === path) {
      return control;
    }
    if (control.type === "folder" && control.children) {
      const found = findControl(control.children, path);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export const DRAG_SENSITIVITY = 4;

// ── Formatting helpers ──

export function formatInteractionLabel(interaction: string): string {
  switch (interaction) {
    case "drag":
      return "Drag";
    case "move":
      return "Move";
    case "scroll-only":
      return "Scroll";
    default:
      return "Scroll";
  }
}

export function formatSliderShortcut(sc: ShortcutConfig): string {
  const interaction = sc.interaction ?? "scroll";
  const actionLabel = formatInteractionLabel(interaction);
  if (!sc.key) {
    return actionLabel;
  }
  const mod = formatModifier(sc.modifier);
  return `${mod}${sc.key.toUpperCase()}+${actionLabel}`;
}

export function formatToggleShortcut(sc: ShortcutConfig): string {
  if (!sc.key) {
    return "Press";
  }
  const mod = formatModifier(sc.modifier);
  return `${mod}${sc.key.toUpperCase()}`;
}

function formatModifier(modifier?: string): string {
  if (modifier === "alt") {
    return "\u2325";
  }
  if (modifier === "shift") {
    return "\u21E7";
  }
  if (modifier === "meta") {
    return "\u2318";
  }
  return "";
}
