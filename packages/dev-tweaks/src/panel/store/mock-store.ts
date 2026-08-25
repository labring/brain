/**
 * Dev mocks as a first-class panel concept, separate from tweaks panels.
 *
 * A tweak is an override value the panel owns; a mock is a remote control
 * for a mode whose truth lives outside the panel (a cookie, the server).
 * The panel therefore never persists mock state itself: every change goes
 * through the mock's source, and every read comes back from it. Sources can
 * report external changes (e.g. the server rewriting its cookie) through
 * `watch`; unchanged reloads are deduped so echoes never cause render churn.
 */

/** The full state of one mock: whether it serves, and which scenario. */
export interface DevTweaksMockState {
  enabled: boolean;
  scenario: string;
}

/**
 * The mock's backing store, owned by the registering feature. `set` must
 * apply synchronously to the local backing store (the store re-`load`s right
 * after it to adopt the canonical state). `watch` reports changes made behind
 * the panel's back and returns an unsubscribe function.
 */
export interface DevTweaksMockSource {
  load(): DevTweaksMockState | null;
  set(state: DevTweaksMockState): void;
  watch?(onChange: () => void): () => void;
}

export interface DevTweaksMockDef {
  /** Scenario used while the source reports nothing. Defaults to the first scenario. */
  defaultScenario?: string;
  /** Short explanation shown under the controls (what the mock serves). */
  note?: string;
  scenarios: readonly string[];
  source: DevTweaksMockSource;
  title: string;
}

/** One registered mock, as the panel renders it. */
export interface MockEntry {
  def: DevTweaksMockDef;
  key: string;
  state: DevTweaksMockState;
}

type Listener = () => void;

interface MockRecord {
  def: DevTweaksMockDef;
  registrationCount: number;
  state: DevTweaksMockState;
  unwatch?: () => void;
}

function fallbackState(def: DevTweaksMockDef): DevTweaksMockState {
  return {
    enabled: false,
    scenario: def.defaultScenario ?? def.scenarios[0] ?? "",
  };
}

/** Clamps a loaded state onto the def: unknown scenarios fall back. */
function sanitizeState(
  def: DevTweaksMockDef,
  loaded: DevTweaksMockState | null
): DevTweaksMockState {
  const fallback = fallbackState(def);
  if (!loaded) {
    return fallback;
  }
  return {
    enabled: loaded.enabled,
    scenario: def.scenarios.includes(loaded.scenario)
      ? loaded.scenario
      : fallback.scenario,
  };
}

function statesEqual(a: DevTweaksMockState, b: DevTweaksMockState): boolean {
  return a.enabled === b.enabled && a.scenario === b.scenario;
}

class MockStoreClass {
  private readonly listeners: Set<Listener> = new Set();
  private readonly mocks: Map<string, MockRecord> = new Map();
  /** Stable between notifications: getSnapshot-style consumers compare by identity. */
  private snapshot: MockEntry[] = [];

  register(key: string, def: DevTweaksMockDef): void {
    const existing = this.mocks.get(key);
    if (existing) {
      existing.registrationCount += 1;
      this.update(key, def);
      return;
    }
    const record: MockRecord = {
      def,
      registrationCount: 1,
      state: sanitizeState(def, def.source.load()),
    };
    this.mocks.set(key, record);
    record.unwatch = def.source.watch?.(() => this.refresh(key));
    this.publish();
  }

  /** Adopts an edited def (HMR) and re-loads through it. */
  update(key: string, def: DevTweaksMockDef): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    record.def = def;
    record.state = sanitizeState(def, def.source.load());
    this.publish();
  }

  unregister(key: string): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    record.registrationCount -= 1;
    if (record.registrationCount > 0) {
      return;
    }
    record.unwatch?.();
    this.mocks.delete(key);
    this.publish();
  }

  getMocks(): MockEntry[] {
    return this.snapshot;
  }

  getState(key: string): DevTweaksMockState | undefined {
    return this.mocks.get(key)?.state;
  }

  isAnyMockEnabled(): boolean {
    return this.snapshot.some((entry) => entry.state.enabled);
  }

  setEnabled(key: string, enabled: boolean): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    this.setState(key, { ...record.state, enabled });
  }

  setScenario(key: string, scenario: string): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    this.setState(key, { ...record.state, scenario });
  }

  /** Writes through the source, then re-loads so the source stays the truth. */
  setState(key: string, state: DevTweaksMockState): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    record.def.source.set(sanitizeState(record.def, state));
    this.refresh(key);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-adopts the source's state; unchanged loads are a no-op (echo dedupe). */
  private refresh(key: string): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    const next = sanitizeState(record.def, record.def.source.load());
    if (statesEqual(record.state, next)) {
      return;
    }
    record.state = next;
    this.publish();
  }

  private publish(): void {
    this.snapshot = Array.from(this.mocks.entries(), ([key, record]) => ({
      def: record.def,
      key,
      state: record.state,
    }));
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// Singleton instance
export const MockStore = /* @__PURE__ */ new MockStoreClass();
