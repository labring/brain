"use client";

import { useMemo, useSyncExternalStore } from "react";

export const PENDING_SETTINGS_SCHEMA_VERSION = 1;
export const PENDING_SETTINGS_STORAGE_KEY =
  "sealai.project-settings.pending-updates.v1";
export const PENDING_SETTINGS_ATTENTION_WINDOW_MS = 30 * 60 * 1000;

export type PendingSettingsOwnerKind = "ap" | "database";

export interface PendingSettingsOwnerIdentity {
  clusterFingerprint: string;
  kind: PendingSettingsOwnerKind;
  name: string;
  namespace: string;
  uid?: string;
}

export interface PendingSettingsUpdateEntry<TTarget = unknown>
  extends PendingSettingsOwnerIdentity {
  domain: string;
  submittedAgainst: TTarget;
  submittedAtMs: number;
  target: TTarget;
  version: typeof PENDING_SETTINGS_SCHEMA_VERSION;
}

export interface PendingSettingsDomainUpdate<TTarget = unknown> {
  domain: string;
  submittedAgainst: TTarget;
  target: TTarget;
}

interface PendingSettingsDocument {
  entries: PendingSettingsUpdateEntry[];
  version: typeof PENDING_SETTINGS_SCHEMA_VERSION;
}

interface PendingSettingsStoreStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface PendingSettingsStore {
  clear: (owner: PendingSettingsOwnerIdentity, domain: string) => void;
  /**
   * Drops the snapshot cache and notifies listeners. For propagating writes
   * that bypassed this instance (another tab's `storage` event).
   */
  invalidateSnapshot: () => void;
  list: (owner: PendingSettingsOwnerIdentity) => PendingSettingsUpdateEntry[];
  replaceDirtyDomains: (input: {
    owner: PendingSettingsOwnerIdentity;
    updates: readonly PendingSettingsDomainUpdate[];
  }) => PendingSettingsUpdateEntry[];
  /** All entries; referentially stable until the next mutation. */
  snapshot: () => readonly PendingSettingsUpdateEntry[];
  /** Notifies after every mutation through this store instance. */
  subscribe: (listener: () => void) => () => void;
}

export type PendingSettingsClassificationStatus =
  | "applying"
  | "attention-needed"
  | "diverged"
  | "reconciled";

export interface PendingSettingsClassification<TTarget = unknown> {
  entry: PendingSettingsUpdateEntry<TTarget>;
  status: PendingSettingsClassificationStatus;
}

function emptyDocument(): PendingSettingsDocument {
  return { entries: [], version: PENDING_SETTINGS_SCHEMA_VERSION };
}

function parseDocument(raw: string | null): PendingSettingsDocument {
  if (raw == null) {
    return emptyDocument();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSettingsDocument>;
    if (
      parsed.version !== PENDING_SETTINGS_SCHEMA_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      return emptyDocument();
    }
    return {
      entries: parsed.entries.filter(isPendingSettingsEntry),
      version: PENDING_SETTINGS_SCHEMA_VERSION,
    };
  } catch {
    return emptyDocument();
  }
}

function writeDocument(
  storage: PendingSettingsStoreStorage,
  document: PendingSettingsDocument
) {
  if (document.entries.length === 0) {
    storage.removeItem(PENDING_SETTINGS_STORAGE_KEY);
    return;
  }
  storage.setItem(PENDING_SETTINGS_STORAGE_KEY, JSON.stringify(document));
}

function isPendingSettingsEntry(
  entry: unknown
): entry is PendingSettingsUpdateEntry {
  if (entry == null || typeof entry !== "object") {
    return false;
  }
  const candidate = entry as Partial<PendingSettingsUpdateEntry>;
  return (
    candidate.version === PENDING_SETTINGS_SCHEMA_VERSION &&
    typeof candidate.clusterFingerprint === "string" &&
    (candidate.kind === "ap" || candidate.kind === "database") &&
    typeof candidate.namespace === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.domain === "string" &&
    Object.hasOwn(candidate, "submittedAgainst") &&
    Object.hasOwn(candidate, "target") &&
    typeof candidate.submittedAtMs === "number" &&
    (candidate.uid === undefined || typeof candidate.uid === "string")
  );
}

function sameOwnerName(
  entry: PendingSettingsOwnerIdentity,
  owner: PendingSettingsOwnerIdentity
) {
  return (
    entry.clusterFingerprint === owner.clusterFingerprint &&
    entry.kind === owner.kind &&
    entry.namespace === owner.namespace &&
    entry.name === owner.name
  );
}

function samePendingOwner(
  entry: PendingSettingsOwnerIdentity,
  owner: PendingSettingsOwnerIdentity
) {
  if (!sameOwnerName(entry, owner)) {
    return false;
  }
  if (entry.uid !== undefined && owner.uid !== undefined) {
    return entry.uid === owner.uid;
  }
  return true;
}

function samePendingDomain(
  entry: PendingSettingsUpdateEntry,
  owner: PendingSettingsOwnerIdentity,
  domain: string
) {
  return samePendingOwner(entry, owner) && entry.domain === domain;
}

export function createPendingSettingsStore({
  now = () => Date.now(),
  storage,
}: {
  now?: () => number;
  storage: PendingSettingsStoreStorage;
}): PendingSettingsStore {
  const read = () =>
    parseDocument(storage.getItem(PENDING_SETTINGS_STORAGE_KEY));
  const listeners = new Set<() => void>();
  let cachedEntries: readonly PendingSettingsUpdateEntry[] | null = null;
  const invalidate = () => {
    cachedEntries = null;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    clear(owner, domain) {
      const document = read();
      writeDocument(storage, {
        entries: document.entries.filter(
          (entry) => !samePendingDomain(entry, owner, domain)
        ),
        version: PENDING_SETTINGS_SCHEMA_VERSION,
      });
      invalidate();
    },
    invalidateSnapshot() {
      invalidate();
    },
    list(owner) {
      return read().entries.filter((entry) => samePendingOwner(entry, owner));
    },
    snapshot() {
      cachedEntries ??= read().entries;
      return cachedEntries;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replaceDirtyDomains({ owner, updates }) {
      if (updates.length === 0) {
        return [];
      }
      const submittedAtMs = now();
      const updatesByDomain = new Map(
        updates.map((update) => [update.domain, update])
      );
      const domains = [...updatesByDomain.keys()];
      const document = read();
      const entries = document.entries.filter(
        (entry) =>
          !domains.some((domain) => samePendingDomain(entry, owner, domain))
      );
      const replacements: PendingSettingsUpdateEntry[] = [
        ...updatesByDomain.values(),
      ].map((update) => ({
        ...owner,
        domain: update.domain,
        submittedAgainst: update.submittedAgainst,
        submittedAtMs,
        target: update.target,
        version: PENDING_SETTINGS_SCHEMA_VERSION,
      }));
      const nextEntries = [...entries, ...replacements];
      writeDocument(storage, {
        entries: nextEntries,
        version: PENDING_SETTINGS_SCHEMA_VERSION,
      });
      invalidate();
      return replacements;
    },
  };
}

const EMPTY_PENDING_ENTRIES: readonly PendingSettingsUpdateEntry[] = [];

function subscribeNothing() {
  return () => undefined;
}

function emptyPendingSnapshot(): readonly PendingSettingsUpdateEntry[] {
  return EMPTY_PENDING_ENTRIES;
}

/**
 * The owner's pending entries, kept fresh through the store's subscription:
 * re-reads exactly when a mutation (any pane, the accept path, or another
 * tab) lands, instead of on every incidental render.
 */
export function usePendingSettingsEntries(
  owner: PendingSettingsOwnerIdentity | null | undefined,
  store: PendingSettingsStore | null
): readonly PendingSettingsUpdateEntry[] {
  // Server snapshot also reads the store when one exists: real SSR has no
  // store (empty), while static-markup tests fake a window and expect the
  // seeded entries to render.
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNothing,
    store?.snapshot ?? emptyPendingSnapshot,
    store?.snapshot ?? emptyPendingSnapshot
  );

  return useMemo(() => {
    if (owner == null) {
      return EMPTY_PENDING_ENTRIES;
    }
    return snapshot.filter((entry) => samePendingOwner(entry, owner));
  }, [owner, snapshot]);
}

let browserPendingSettingsStore: {
  storage: unknown;
  store: PendingSettingsStore;
} | null = null;

/**
 * Browser-global singleton so every consumer shares one subscription surface:
 * a mutation from any pane (or the submission store's accept path) notifies
 * all subscribed panes. Cross-tab writes arrive via the `storage` event.
 * Keyed on the localStorage instance so tests that swap in a fake window get
 * a fresh store instead of one bound to a previous test's storage.
 */
export function getBrowserPendingSettingsStore(): PendingSettingsStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  if (browserPendingSettingsStore?.storage !== storage) {
    const store = createPendingSettingsStore({ storage });
    if (typeof window.addEventListener === "function") {
      window.addEventListener("storage", (event) => {
        if (event.key === PENDING_SETTINGS_STORAGE_KEY || event.key == null) {
          store.invalidateSnapshot();
        }
      });
    }
    browserPendingSettingsStore = { storage, store };
  }
  return browserPendingSettingsStore.store;
}

export function classifyPendingSettingsEntry<TTarget>(
  entry: PendingSettingsUpdateEntry<TTarget>,
  {
    equals,
    now = () => Date.now(),
    observed,
  }: {
    equals: (left: TTarget, right: TTarget) => boolean;
    now?: () => number;
    observed: TTarget;
  }
): PendingSettingsClassification<TTarget> {
  if (equals(observed, entry.target)) {
    return { entry, status: "reconciled" };
  }
  if (equals(observed, entry.submittedAgainst)) {
    return {
      entry,
      status:
        now() - entry.submittedAtMs >= PENDING_SETTINGS_ATTENTION_WINDOW_MS
          ? "attention-needed"
          : "applying",
    };
  }
  return { entry, status: "diverged" };
}

export async function pendingSettingsClusterFingerprint(
  rawKubeconfig: string
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKubeconfig)
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
