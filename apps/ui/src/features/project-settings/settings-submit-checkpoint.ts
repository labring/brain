export const SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION = 1;
export const SETTINGS_SUBMIT_CHECKPOINT_STORAGE_KEY =
  "sealai.project-settings.submit-checkpoints.v1";

export type SettingsSubmitCheckpointStatus = "failed" | "submitting";

export interface SettingsSubmitCheckpoint<TDraft = unknown> {
  base: TDraft;
  draft: TDraft;
  errorMessage?: string;
  ownerKey: string;
  status: SettingsSubmitCheckpointStatus;
  submittedAtMs: number;
  version: typeof SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION;
}

interface SettingsSubmitCheckpointDocument {
  checkpoints: SettingsSubmitCheckpoint[];
  version: typeof SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION;
}

interface SettingsSubmitCheckpointStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface SettingsSubmitCheckpointStore {
  clear: (ownerKey: string) => void;
  fail: (ownerKey: string, error: unknown) => SettingsSubmitCheckpoint | null;
  get: <TDraft>(ownerKey: string) => SettingsSubmitCheckpoint<TDraft> | null;
  start: <TDraft>(input: {
    base: TDraft;
    draft: TDraft;
    ownerKey: string;
  }) => SettingsSubmitCheckpoint<TDraft>;
}

function emptyDocument(): SettingsSubmitCheckpointDocument {
  return {
    checkpoints: [],
    version: SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "Update failed.";
}

function isCheckpoint(value: unknown): value is SettingsSubmitCheckpoint {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SettingsSubmitCheckpoint>;
  return (
    candidate.version === SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION &&
    typeof candidate.ownerKey === "string" &&
    (candidate.status === "failed" || candidate.status === "submitting") &&
    typeof candidate.submittedAtMs === "number" &&
    Object.hasOwn(candidate, "base") &&
    Object.hasOwn(candidate, "draft") &&
    (candidate.errorMessage === undefined ||
      typeof candidate.errorMessage === "string")
  );
}

function parseDocument(raw: string | null): SettingsSubmitCheckpointDocument {
  if (raw == null) {
    return emptyDocument();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsSubmitCheckpointDocument>;
    if (
      parsed.version !== SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION ||
      !Array.isArray(parsed.checkpoints)
    ) {
      return emptyDocument();
    }
    return {
      checkpoints: parsed.checkpoints.filter(isCheckpoint),
      version: SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION,
    };
  } catch {
    return emptyDocument();
  }
}

function writeDocument(
  storage: SettingsSubmitCheckpointStorage,
  document: SettingsSubmitCheckpointDocument
) {
  if (document.checkpoints.length === 0) {
    storage.removeItem(SETTINGS_SUBMIT_CHECKPOINT_STORAGE_KEY);
    return;
  }
  storage.setItem(
    SETTINGS_SUBMIT_CHECKPOINT_STORAGE_KEY,
    JSON.stringify(document)
  );
}

function withoutOwner(
  document: SettingsSubmitCheckpointDocument,
  ownerKey: string
): SettingsSubmitCheckpoint[] {
  return document.checkpoints.filter(
    (checkpoint) => checkpoint.ownerKey !== ownerKey
  );
}

export function createSettingsSubmitCheckpointStore({
  now = () => Date.now(),
  storage,
}: {
  now?: () => number;
  storage: SettingsSubmitCheckpointStorage;
}): SettingsSubmitCheckpointStore {
  const read = () =>
    parseDocument(storage.getItem(SETTINGS_SUBMIT_CHECKPOINT_STORAGE_KEY));

  return {
    clear(ownerKey) {
      const document = read();
      writeDocument(storage, {
        checkpoints: withoutOwner(document, ownerKey),
        version: SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION,
      });
    },
    fail(ownerKey, error) {
      const document = read();
      const existing = document.checkpoints.find(
        (checkpoint) => checkpoint.ownerKey === ownerKey
      );
      if (existing == null) {
        return null;
      }
      const failed = {
        ...existing,
        errorMessage: errorMessage(error),
        status: "failed" as const,
      };
      writeDocument(storage, {
        checkpoints: [...withoutOwner(document, ownerKey), failed],
        version: SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION,
      });
      return failed;
    },
    get<TDraft>(ownerKey: string) {
      return (
        (read().checkpoints.find(
          (checkpoint) => checkpoint.ownerKey === ownerKey
        ) as SettingsSubmitCheckpoint<TDraft> | undefined) ?? null
      );
    },
    start<TDraft>({
      base,
      draft,
      ownerKey,
    }: {
      base: TDraft;
      draft: TDraft;
      ownerKey: string;
    }) {
      const document = read();
      const checkpoint: SettingsSubmitCheckpoint<TDraft> = {
        base,
        draft,
        ownerKey,
        status: "submitting" as const,
        submittedAtMs: now(),
        version: SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION,
      };
      writeDocument(storage, {
        checkpoints: [...withoutOwner(document, ownerKey), checkpoint],
        version: SETTINGS_SUBMIT_CHECKPOINT_SCHEMA_VERSION,
      });
      return checkpoint;
    },
  };
}

export function getBrowserSettingsSubmitCheckpointStore(): SettingsSubmitCheckpointStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  return createSettingsSubmitCheckpointStore({ storage: window.localStorage });
}
