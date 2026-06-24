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
  list: (owner: PendingSettingsOwnerIdentity) => PendingSettingsUpdateEntry[];
  replaceDirtyDomains: (input: {
    owner: PendingSettingsOwnerIdentity;
    updates: readonly PendingSettingsDomainUpdate[];
  }) => PendingSettingsUpdateEntry[];
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

  return {
    clear(owner, domain) {
      const document = read();
      writeDocument(storage, {
        entries: document.entries.filter(
          (entry) => !samePendingDomain(entry, owner, domain)
        ),
        version: PENDING_SETTINGS_SCHEMA_VERSION,
      });
    },
    list(owner) {
      return read().entries.filter((entry) => samePendingOwner(entry, owner));
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
      return replacements;
    },
  };
}

export function getBrowserPendingSettingsStore(): PendingSettingsStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  return createPendingSettingsStore({ storage: window.localStorage });
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
