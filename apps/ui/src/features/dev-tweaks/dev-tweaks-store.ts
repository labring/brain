/**
 * Dev-only tweak registry backing the dev tweaks pane (toggle with ⌃⌥T).
 *
 * Components declare numeric knobs with `useDevTweaks`; the pane renders a
 * slider per knob and writes overrides back as inline CSS custom properties.
 * CSS stays the source of truth for defaults — `value` in a def only seeds
 * the slider, so keep it in sync with the custom-property default it mirrors.
 */

export interface DevTweakDef {
  /** CSS custom property the knob writes, e.g. "--horizon-glow-w". */
  cssVar?: string;
  label: string;
  max: number;
  min: number;
  step?: number;
  /** Unit appended when formatting the CSS value. */
  unit?: "%" | "px" | "s";
  /** Default value — mirrors the CSS custom-property default. */
  value: number;
}

export interface DevTweaksGroupDef<
  T extends Record<string, DevTweakDef> = Record<string, DevTweakDef>,
> {
  /** Hint shown in the pane for where copied values should be pasted back. */
  note?: string;
  title: string;
  tweaks: T;
}

export type DevTweakOverrides = Readonly<Record<string, number>>;

export interface RegisteredDevTweaksGroup {
  def: DevTweaksGroupDef;
  key: string;
}

export const EMPTY_DEV_TWEAK_OVERRIDES: DevTweakOverrides = Object.freeze({});

const EMPTY_GROUPS: readonly RegisteredDevTweaksGroup[] = Object.freeze([]);

const STORAGE_KEY = "sealai.dev-tweaks.v1";

/** Only overrides persist — the pane always starts closed and unpaused. */
interface PersistedState {
  overrides?: Record<string, Record<string, number>>;
}

class DevTweaksStore {
  private readonly groups = new Map<
    string,
    { def: DevTweaksGroupDef; refCount: number }
  >();
  private groupsSnapshot: readonly RegisteredDevTweaksGroup[] = EMPTY_GROUPS;
  private readonly listeners = new Set<() => void>();
  private loaded = false;
  private open = false;
  private overrides: Record<string, DevTweakOverrides> = {};
  private paused = false;

  clearGroupOverrides(groupKey: string) {
    if (!(groupKey in this.overrides)) {
      return;
    }
    const { [groupKey]: _removed, ...rest } = this.overrides;
    this.overrides = rest;
    this.persist();
    this.notify();
  }

  clearOverride(groupKey: string, tweakKey: string) {
    const group = this.overrides[groupKey];
    if (!(group && tweakKey in group)) {
      return;
    }
    const { [tweakKey]: _removed, ...rest } = group;
    this.overrides = { ...this.overrides };
    if (Object.keys(rest).length === 0) {
      delete this.overrides[groupKey];
    } else {
      this.overrides[groupKey] = Object.freeze(rest);
    }
    this.persist();
    this.notify();
  }

  getGroups = (): readonly RegisteredDevTweaksGroup[] => this.groupsSnapshot;

  getOverrides = (groupKey: string): DevTweakOverrides =>
    this.overrides[groupKey] ?? EMPTY_DEV_TWEAK_OVERRIDES;

  isOpen = (): boolean => this.open;

  isPaused = (): boolean => this.paused;

  register(key: string, def: DevTweaksGroupDef): () => void {
    const existing = this.groups.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.def = def;
    } else {
      this.groups.set(key, { def, refCount: 1 });
    }
    this.rebuildGroupsSnapshot();
    this.notify();
    return () => {
      const entry = this.groups.get(key);
      if (!entry) {
        return;
      }
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        this.groups.delete(key);
      }
      this.rebuildGroupsSnapshot();
      this.notify();
    };
  }

  setOpen(open: boolean) {
    if (this.open === open) {
      return;
    }
    this.open = open;
    this.notify();
  }

  setOverride(groupKey: string, tweakKey: string, value: number) {
    const group = this.overrides[groupKey] ?? EMPTY_DEV_TWEAK_OVERRIDES;
    if (group[tweakKey] === value) {
      return;
    }
    this.overrides = {
      ...this.overrides,
      [groupKey]: Object.freeze({ ...group, [tweakKey]: value }),
    };
    this.persist();
    this.notify();
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.ensureLoaded();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private ensureLoaded() {
    if (this.loaded || typeof window === "undefined") {
      return;
    }
    this.loaded = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const persisted = JSON.parse(raw) as PersistedState;
      for (const [groupKey, groupOverrides] of Object.entries(
        persisted.overrides ?? {}
      )) {
        const clean: Record<string, number> = {};
        for (const [tweakKey, value] of Object.entries(groupOverrides ?? {})) {
          if (typeof value === "number" && Number.isFinite(value)) {
            clean[tweakKey] = value;
          }
        }
        if (Object.keys(clean).length > 0) {
          this.overrides[groupKey] = Object.freeze(clean);
        }
      }
      queueMicrotask(() => this.notify());
    } catch {
      // Corrupt persisted state is not worth surfacing; start fresh.
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private persist() {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const state: PersistedState = {
        overrides: { ...this.overrides },
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota or privacy-mode errors are non-fatal for a dev tool.
    }
  }

  private rebuildGroupsSnapshot() {
    this.groupsSnapshot = Object.freeze(
      [...this.groups.entries()]
        .map(([key, entry]) => ({ def: entry.def, key }))
        .sort((a, b) => a.def.title.localeCompare(b.def.title))
    );
  }
}

export const devTweaksStore = new DevTweaksStore();

export function formatDevTweakValue(def: DevTweakDef, value: number): string {
  return `${value}${def.unit ?? ""}`;
}

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  // Console escape hatch: window.__devTweaksStore.setOverride(...) etc.
  (globalThis as { __devTweaksStore?: DevTweaksStore }).__devTweaksStore =
    devTweaksStore;
}
