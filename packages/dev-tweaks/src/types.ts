/**
 * Declarative control registry types. A group def must stay serializable as a
 * whole (no functions): overrides persist a full def snapshot so the panel's
 * "Active" section can render and edit them on screens where the owning
 * component is not mounted.
 */

export interface DevTweaksSliderDef {
  /** CSS custom property the override writes, e.g. "--horizon-glow-w". */
  cssVar?: string;
  label: string;
  max: number;
  min: number;
  step?: number;
  type: "slider";
  /** Unit appended when formatting the CSS value and shown after the number. */
  unit?: string;
  /** Default value — mirrors the CSS custom-property default. */
  value: number;
}

export interface DevTweaksNumberDef {
  cssVar?: string;
  label: string;
  max?: number;
  min?: number;
  step?: number;
  type: "number";
  unit?: string;
  value: number;
}

export interface DevTweaksSwitchDef {
  label: string;
  type: "switch";
  value: boolean;
}

export interface DevTweaksSelectDef {
  label: string;
  options: readonly string[];
  type: "select";
  value: string;
}

export interface DevTweaksColorDef {
  cssVar?: string;
  label: string;
  type: "color";
  /** Hex color string, e.g. "#f5a623". */
  value: string;
}

export type DevTweaksControlDef =
  | DevTweaksColorDef
  | DevTweaksNumberDef
  | DevTweaksSelectDef
  | DevTweaksSliderDef
  | DevTweaksSwitchDef;

export type DevTweaksValue = boolean | number | string;

/** Value type carried by one control, inferred from its discriminant. */
export type DevTweaksControlValue<C extends DevTweaksControlDef> = C extends {
  type: "switch";
}
  ? boolean
  : C extends { options: readonly (infer O extends string)[]; type: "select" }
    ? O
    : C extends { type: "color" }
      ? string
      : number;

export interface DevTweaksGroupDef<
  T extends Record<string, DevTweaksControlDef> = Record<
    string,
    DevTweaksControlDef
  >,
> {
  controls: T;
  /** Feature the group belongs to; shown as an inline tag in the panel. */
  feature: string;
  /** Mock groups sort before tweak groups and light the MOCK indicator. */
  kind: "mock" | "tweak";
  note?: string;
  /** Reserved manual ordering among same-kind groups; lower sorts first. */
  order?: number;
  /**
   * Name of a host persistence driver registered on the Provider. Unset
   * groups persist to the package's own sessionStorage driver.
   */
  persistence?: string;
  title: string;
}

export type DevTweaksValues<T extends Record<string, DevTweaksControlDef>> =
  Readonly<{ [K in keyof T]: DevTweaksControlValue<T[K]> }>;

/**
 * Pluggable persistence for one group's override values. `persist` is also
 * the seam for host side effects (e.g. write a cookie, then drop the SWR
 * cache) — there is no separate effects system.
 */
export interface DevTweaksDriver {
  /** Read persisted override values; null/undefined when none are stored. */
  load(groupKey: string): Record<string, DevTweaksValue> | null | undefined;
  /** Write override values; `null` means the overrides were cleared. */
  persist(
    groupKey: string,
    values: Record<string, DevTweaksValue> | null
  ): void;
  /**
   * Optional: watch the backing store for changes made behind the panel's
   * back (e.g. a server response rewriting a mock cookie). Called once per
   * group; on `onChange` the store re-`load`s and replaces the group's
   * overrides. Returns an unsubscribe function.
   */
  subscribe?(groupKey: string, onChange: () => void): () => void;
}

/** One override row for the "Active" section, flattened per control. */
export interface DevTweaksActiveEntry {
  /** Activation order — entries are listed oldest first. */
  at: number;
  controlDef: DevTweaksControlDef;
  controlKey: string;
  groupDef: DevTweaksGroupDef;
  groupKey: string;
  value: DevTweaksValue;
}

export interface DevTweaksRegisteredGroup {
  def: DevTweaksGroupDef;
  key: string;
  /** Monotonic registration sequence — the "This screen" base order. */
  seq: number;
}
