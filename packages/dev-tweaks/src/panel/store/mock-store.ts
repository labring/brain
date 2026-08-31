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
  /**
   * Called by the store after the mock's served answers changed — a toggle,
   * an enabled scenario switch, or an external rewrite (the server advancing
   * its cookie). Not called for changes that cannot affect what is served,
   * such as picking a scenario while the mock is off.
   */
  revalidate?(): void;
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

/**
 * True when the change alters what the mock serves: a toggle either way, or
 * a scenario switch while it serves. A scenario picked while the mock is off
 * changes nothing on the page, so it must not revalidate (or reload).
 */
function servedAnswersDiffer(
  a: DevTweaksMockState,
  b: DevTweaksMockState
): boolean {
  return a.enabled !== b.enabled || (b.enabled && a.scenario !== b.scenario);
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

  /** Adopts an edited def (HMR) without disturbing the current state. */
  update(key: string, def: DevTweaksMockDef): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    if (record.def.source !== def.source) {
      record.unwatch?.();
      record.unwatch = def.source.watch?.(() => this.refresh(key));
    }
    record.def = def;
    // Re-clamp against the (possibly changed) scenario list, but never
    // re-load: a second registrant of the same key must not clobber state.
    record.state = sanitizeState(def, record.state);
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
    this.setState(key, { ...this.currentSourceState(record), enabled });
  }

  setScenario(key: string, scenario: string): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    this.setState(key, { ...this.currentSourceState(record), scenario });
  }

  /** Writes through the source, then re-loads so the source stays the truth. */
  setState(key: string, state: DevTweaksMockState): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    const target = sanitizeState(record.def, state);
    record.def.source.set(target);
    this.refresh(key);
    // The source is the truth: a write it did not adopt is a failed write,
    // and silence here is what turns that into a dead control.
    if (!statesEqual(this.currentSourceState(record), target)) {
      console.warn(
        `[dev-tweaks] mock "${key}" write did not take — its source still reports a different state`
      );
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The source's state right now — the base every write builds on, so a
   * change made behind the panel's back (a server `Set-Cookie` transition the
   * watch has not delivered yet) is merged instead of clobbered.
   */
  private currentSourceState(record: MockRecord): DevTweaksMockState {
    return sanitizeState(record.def, record.def.source.load());
  }

  /**
   * Re-adopts the source's state; unchanged loads are a no-op (echo dedupe).
   * When the adopted change alters what the mock serves, the def's
   * `revalidate` runs — this covers both panel writes (setState lands here)
   * and external rewrites delivered through `watch`, so a server-advanced
   * scenario refreshes the page's data, not just the panel.
   */
  private refresh(key: string): void {
    const record = this.mocks.get(key);
    if (!record) {
      return;
    }
    const next = sanitizeState(record.def, record.def.source.load());
    if (statesEqual(record.state, next)) {
      return;
    }
    const revalidate = servedAnswersDiffer(record.state, next);
    record.state = next;
    this.publish();
    if (revalidate) {
      record.def.revalidate?.();
    }
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
