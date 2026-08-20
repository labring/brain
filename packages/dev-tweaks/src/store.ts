import type {
  DevTweaksActiveEntry,
  DevTweaksControlDef,
  DevTweaksDriver,
  DevTweaksGroupDef,
  DevTweaksRegisteredGroup,
  DevTweaksValue,
} from "./types";

/** Package default — deliberately host-agnostic. */
export const DEFAULT_STORAGE_KEY = "dev-tweaks.v1";

export const EMPTY_OVERRIDE_VALUES: Readonly<Record<string, DevTweaksValue>> =
  Object.freeze({});

const EMPTY_GROUPS: readonly DevTweaksRegisteredGroup[] = Object.freeze([]);
const EMPTY_ACTIVE: readonly DevTweaksActiveEntry[] = Object.freeze([]);

interface MountedGroup {
  def: DevTweaksGroupDef;
  refCount: number;
  seq: number;
}

interface OverrideEntry {
  /** Per-control activation order (monotonic, persisted). */
  at: Record<string, number>;
  /** Def snapshot — lets "Active" render/edit the group cross-page. */
  def: DevTweaksGroupDef;
  values: Readonly<Record<string, DevTweaksValue>>;
}

interface StoredGroup {
  at?: Record<string, number>;
  def?: DevTweaksGroupDef;
  /** Absent for driver-backed groups — the driver owns the values. */
  values?: Record<string, DevTweaksValue>;
}

interface StoredState {
  groups?: Record<string, StoredGroup>;
}

function isControlValueValid(
  def: DevTweaksControlDef,
  value: unknown
): value is DevTweaksValue {
  switch (def.type) {
    case "switch":
      return typeof value === "boolean";
    case "select":
      return typeof value === "string" && def.options.includes(value);
    case "color":
      return typeof value === "string";
    default:
      return typeof value === "number" && Number.isFinite(value);
  }
}

function isGroupDefLike(value: unknown): value is DevTweaksGroupDef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const def = value as Partial<DevTweaksGroupDef>;
  return (
    typeof def.title === "string" &&
    typeof def.feature === "string" &&
    (def.kind === "mock" || def.kind === "tweak") &&
    typeof def.controls === "object" &&
    def.controls !== null
  );
}

function shallowEqualValues(
  a: Readonly<Record<string, DevTweaksValue>> | undefined,
  b: Readonly<Record<string, DevTweaksValue>>
): boolean {
  if (!a) {
    return false;
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/** Keeps only override values that a def snapshot can still render. */
function sanitizeValues(
  def: DevTweaksGroupDef,
  values: Record<string, unknown> | null | undefined
): { at?: Record<string, number>; values: Record<string, DevTweaksValue> } {
  const clean: Record<string, DevTweaksValue> = {};
  if (!values) {
    return { values: clean };
  }
  for (const [controlKey, value] of Object.entries(values)) {
    const controlDef = def.controls[controlKey];
    if (controlDef && isControlValueValid(controlDef, value)) {
      clean[controlKey] = value;
    }
  }
  return { values: clean };
}

export interface DevTweaksStoreOptions {
  drivers?: Record<string, DevTweaksDriver>;
  storageKey?: string;
}

/**
 * Single source of truth for control values and panel visibility. All
 * consumers (hook, panel, indicator) only ever ask this store; persistence is
 * a pluggable layer underneath it.
 */
export class DevTweaksStore {
  private activeSnapshot: readonly DevTweaksActiveEntry[] = EMPTY_ACTIVE;
  private activeSnapshotDirty = false;
  private atCounter = 1;
  private readonly drivers: Record<string, DevTweaksDriver>;
  /** Group keys whose driver is being watched — one subscription per group. */
  private readonly driverSubscriptions = new Set<string>();
  /** Bumped by requestActiveFocus so the panel can scroll + highlight. */
  private focusActiveCounter = 0;
  private readonly groups = new Map<string, MountedGroup>();
  private groupsSnapshot: readonly DevTweaksRegisteredGroup[] = EMPTY_GROUPS;
  private groupsSnapshotDirty = false;
  private readonly listeners = new Set<() => void>();
  private loaded = false;
  private open = false;
  private readonly overrides = new Map<string, OverrideEntry>();
  private seqCounter = 1;
  private readonly storageKey: string;
  private readonly warnedDrivers = new Set<string>();

  constructor(options: DevTweaksStoreOptions = {}) {
    this.drivers = options.drivers ?? {};
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  }

  clearAll(): void {
    this.ensureLoaded();
    if (this.overrides.size === 0) {
      return;
    }
    for (const [groupKey, entry] of this.overrides) {
      this.resolveDriver(entry.def)?.persist(groupKey, null);
    }
    this.overrides.clear();
    this.persistSession();
    this.activeSnapshotDirty = true;
    this.notify();
  }

  clearGroup(groupKey: string): void {
    this.ensureLoaded();
    const entry = this.overrides.get(groupKey);
    if (!entry) {
      return;
    }
    this.overrides.delete(groupKey);
    this.resolveDriver(entry.def)?.persist(groupKey, null);
    this.persistSession();
    this.activeSnapshotDirty = true;
    this.notify();
  }

  clearOverride(groupKey: string, controlKey: string): void {
    this.ensureLoaded();
    const entry = this.overrides.get(groupKey);
    if (!(entry && controlKey in entry.values)) {
      return;
    }
    const values: Record<string, DevTweaksValue> = { ...entry.values };
    delete values[controlKey];
    const at = { ...entry.at };
    delete at[controlKey];
    const driver = this.resolveDriver(entry.def);
    if (Object.keys(values).length === 0) {
      this.overrides.delete(groupKey);
      driver?.persist(groupKey, null);
    } else {
      this.overrides.set(groupKey, { at, def: entry.def, values });
      driver?.persist(groupKey, values);
    }
    this.persistSession();
    this.activeSnapshotDirty = true;
    this.notify();
  }

  getActiveEntries = (): readonly DevTweaksActiveEntry[] => {
    if (this.activeSnapshotDirty || this.activeSnapshot === EMPTY_ACTIVE) {
      this.rebuildActiveSnapshot();
    }
    return this.activeSnapshot;
  };

  getFocusActiveCounter = (): number => this.focusActiveCounter;

  getGroups = (): readonly DevTweaksRegisteredGroup[] => {
    if (this.groupsSnapshotDirty) {
      this.rebuildGroupsSnapshot();
    }
    return this.groupsSnapshot;
  };

  getOverrides = (groupKey: string): Readonly<Record<string, DevTweaksValue>> =>
    this.overrides.get(groupKey)?.values ?? EMPTY_OVERRIDE_VALUES;

  isOpen = (): boolean => this.open;

  /**
   * Registers a mounted group ("this screen" semantics). Ref-counted; the
   * returned function unregisters. Re-registration refreshes the def
   * snapshot carried by any persisted override of the same group.
   */
  register(key: string, def: DevTweaksGroupDef): () => void {
    this.ensureLoaded();
    const existing = this.groups.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.def = def;
    } else {
      this.groups.set(key, { def, refCount: 1, seq: this.seqCounter });
      this.seqCounter += 1;
    }
    this.refreshOverrideSnapshot(key, def);
    this.adoptDriverValues(key, def);
    this.watchDriver(key, def);
    this.groupsSnapshotDirty = true;
    this.activeSnapshotDirty = true;
    this.notify();
    return () => {
      const registered = this.groups.get(key);
      if (!registered) {
        return;
      }
      registered.refCount -= 1;
      if (registered.refCount <= 0) {
        this.groups.delete(key);
      }
      this.groupsSnapshotDirty = true;
      this.notify();
    };
  }

  requestActiveFocus(): void {
    this.open = true;
    this.focusActiveCounter += 1;
    this.notify();
  }

  setOpen(open: boolean): void {
    if (this.open === open) {
      return;
    }
    this.open = open;
    this.notify();
  }

  setValue(groupKey: string, controlKey: string, value: DevTweaksValue): void {
    this.ensureLoaded();
    const def =
      this.overrides.get(groupKey)?.def ?? this.groups.get(groupKey)?.def;
    const controlDef = def?.controls[controlKey];
    if (!(def && controlDef && isControlValueValid(controlDef, value))) {
      return;
    }
    const entry = this.overrides.get(groupKey);
    const values: Record<string, DevTweaksValue> = {
      ...entry?.values,
      [controlKey]: value,
    };
    const at = { ...entry?.at };
    if (at[controlKey] === undefined) {
      at[controlKey] = this.atCounter;
      this.atCounter += 1;
    }
    this.overrides.set(groupKey, { at, def, values });
    this.resolveDriver(def)?.persist(groupKey, values);
    this.persistSession();
    this.activeSnapshotDirty = true;
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.ensureLoaded();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Adopts values a host driver already holds (e.g. a mock cookie written in
   * an earlier session) the first time its group registers.
   */
  private adoptDriverValues(key: string, def: DevTweaksGroupDef): void {
    if (this.overrides.has(key) || typeof window === "undefined") {
      return;
    }
    const driver = this.resolveDriver(def);
    if (!driver) {
      return;
    }
    const { values } = sanitizeValues(def, driver.load(key));
    if (Object.keys(values).length === 0) {
      return;
    }
    const at: Record<string, number> = {};
    for (const controlKey of Object.keys(values)) {
      at[controlKey] = this.atCounter;
      this.atCounter += 1;
    }
    this.overrides.set(key, { at, def, values });
    this.persistSession();
  }

  /**
   * Re-adopts a watched driver's values after it reports an external change
   * (e.g. the server rewrote a mock cookie). Unchanged values are a no-op so
   * the driver's own `persist` echoes never cause render churn.
   */
  private refreshFromDriver(key: string): void {
    const def = this.overrides.get(key)?.def ?? this.groups.get(key)?.def;
    if (!def) {
      return;
    }
    const driver = this.resolveDriver(def);
    if (!driver) {
      return;
    }
    const { values } = sanitizeValues(def, driver.load(key));
    const entry = this.overrides.get(key);
    if (Object.keys(values).length === 0) {
      if (!entry) {
        return;
      }
      this.overrides.delete(key);
    } else {
      if (shallowEqualValues(entry?.values, values)) {
        return;
      }
      const at: Record<string, number> = {};
      for (const controlKey of Object.keys(values)) {
        const existing = entry?.at[controlKey];
        if (existing === undefined) {
          at[controlKey] = this.atCounter;
          this.atCounter += 1;
        } else {
          at[controlKey] = existing;
        }
      }
      this.overrides.set(key, { at, def, values });
    }
    this.persistSession();
    this.activeSnapshotDirty = true;
    this.notify();
  }

  /**
   * Starts the driver's external-change watch for a group, once per group
   * key. Deliberately never unsubscribed: like the sessionStorage layer, a
   * driver-backed group stays editable from the "Active" section while its
   * owning component is unmounted, so the watch must outlive the mount.
   */
  private watchDriver(key: string, def: DevTweaksGroupDef): void {
    if (this.driverSubscriptions.has(key) || typeof window === "undefined") {
      return;
    }
    const driver = this.resolveDriver(def);
    if (!driver?.subscribe) {
      return;
    }
    this.driverSubscriptions.add(key);
    driver.subscribe(key, () => this.refreshFromDriver(key));
  }

  private ensureLoaded(): void {
    if (this.loaded || typeof window === "undefined") {
      return;
    }
    this.loaded = true;
    let stored: StoredState | null = null;
    try {
      const raw = window.sessionStorage.getItem(this.storageKey);
      stored = raw ? (JSON.parse(raw) as StoredState) : null;
    } catch {
      stored = null;
    }
    if (stored?.groups) {
      for (const [groupKey, group] of Object.entries(stored.groups)) {
        this.restoreStoredGroup(groupKey, group);
      }
    }
    this.activeSnapshotDirty = true;
    // Deferred so a subscribe during render never mutates mid-render.
    queueMicrotask(() => this.notify());
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private persistSession(): void {
    if (typeof window === "undefined") {
      return;
    }
    const groups: Record<string, StoredGroup> = {};
    for (const [groupKey, entry] of this.overrides) {
      const driverBacked = this.resolveDriver(entry.def) !== undefined;
      groups[groupKey] = {
        at: entry.at,
        def: entry.def,
        // Driver-backed values live in the driver — only one copy on disk.
        ...(driverBacked ? {} : { values: { ...entry.values } }),
      };
    }
    try {
      window.sessionStorage.setItem(
        this.storageKey,
        JSON.stringify({ groups })
      );
    } catch {
      // Quota/denied — overrides simply won't survive a refresh.
    }
  }

  private rebuildActiveSnapshot(): void {
    this.activeSnapshotDirty = false;
    const entries: DevTweaksActiveEntry[] = [];
    for (const [groupKey, entry] of this.overrides) {
      for (const [controlKey, value] of Object.entries(entry.values)) {
        const controlDef = entry.def.controls[controlKey];
        if (!controlDef) {
          continue;
        }
        entries.push({
          at: entry.at[controlKey] ?? 0,
          controlDef,
          controlKey,
          groupDef: entry.def,
          groupKey,
          value,
        });
      }
    }
    entries.sort((a, b) => a.at - b.at);
    this.activeSnapshot =
      entries.length === 0 ? EMPTY_ACTIVE : Object.freeze(entries);
  }

  private rebuildGroupsSnapshot(): void {
    this.groupsSnapshotDirty = false;
    const groups = [...this.groups.entries()].map(([key, group]) => ({
      def: group.def,
      key,
      seq: group.seq,
    }));
    groups.sort((a, b) => {
      const orderA = a.def.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.def.order ?? Number.MAX_SAFE_INTEGER;
      return orderA === orderB ? a.seq - b.seq : orderA - orderB;
    });
    this.groupsSnapshot =
      groups.length === 0 ? EMPTY_GROUPS : Object.freeze(groups);
  }

  /** Def snapshots refresh whenever their group (re)mounts. */
  private refreshOverrideSnapshot(key: string, def: DevTweaksGroupDef): void {
    const entry = this.overrides.get(key);
    if (!entry) {
      return;
    }
    const { values } = sanitizeValues(def, { ...entry.values });
    if (Object.keys(values).length === 0) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, { at: entry.at, def, values });
    }
    this.persistSession();
  }

  private resolveDriver(def: DevTweaksGroupDef): DevTweaksDriver | undefined {
    const name = def.persistence;
    if (name === undefined) {
      return;
    }
    const driver = this.drivers[name];
    if (!driver) {
      if (!this.warnedDrivers.has(name)) {
        this.warnedDrivers.add(name);
        console.warn(
          `[dev-tweaks] No persistence driver named "${name}" is registered on the Provider — falling back to sessionStorage.`
        );
      }
      return;
    }
    return driver;
  }

  private restoreStoredGroup(groupKey: string, group: StoredGroup): void {
    if (!isGroupDefLike(group.def)) {
      return;
    }
    const def = group.def;
    const driver = this.resolveDriver(def);
    const raw = driver ? driver.load(groupKey) : group.values;
    const { values } = sanitizeValues(def, raw);
    if (Object.keys(values).length === 0) {
      return;
    }
    const at: Record<string, number> = {};
    for (const controlKey of Object.keys(values)) {
      const storedAt = group.at?.[controlKey];
      at[controlKey] =
        typeof storedAt === "number" && Number.isFinite(storedAt)
          ? storedAt
          : this.atCounter;
      this.atCounter = Math.max(this.atCounter, at[controlKey] + 1);
    }
    this.overrides.set(groupKey, { at, def, values });
    this.watchDriver(groupKey, def);
  }
}
