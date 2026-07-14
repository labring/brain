"use client";

import { useMemo, useSyncExternalStore } from "react";
import type {
  PendingSettingsDomainUpdate,
  PendingSettingsOwnerIdentity,
  PendingSettingsStore,
  PendingSettingsUpdateEntry,
} from "./pending-settings-updates";

export type SettingsSubmissionStatus = "rejected" | "submitting";

export interface SettingsSubmissionDomainUpdate<TTarget = unknown>
  extends PendingSettingsDomainUpdate<TTarget> {}

export interface SettingsSubmissionEntry<TDraft = unknown, TTarget = unknown>
  extends PendingSettingsOwnerIdentity {
  baseDraft: TDraft;
  domain: string;
  draft: TDraft;
  errorMessage?: string;
  id: string;
  status: SettingsSubmissionStatus;
  submissionId: string;
  submittedAgainst: TTarget;
  submittedAtMs: number;
  target: TTarget;
}

export interface SettingsSubmissionRecovery<TDraft = unknown> {
  baseDraft: TDraft;
  domains: readonly string[];
  draft: TDraft;
  errorMessage?: string;
  submissionId: string;
  submittedAtMs: number;
}

export type SettingsSubmissionStartResult<TDraft = unknown, TTarget = unknown> =
  | {
      domains: readonly string[];
      status: "blocked";
    }
  | {
      entries: readonly SettingsSubmissionEntry<TDraft, TTarget>[];
      status: "started";
    };

export interface SettingsSubmissionStore {
  accept: (input: {
    entries: readonly SettingsSubmissionEntry[];
    owner: PendingSettingsOwnerIdentity;
    pendingStore?: PendingSettingsStore | null;
  }) => PendingSettingsUpdateEntry[];
  clear: (input: {
    domains?: readonly string[];
    owner: PendingSettingsOwnerIdentity;
    statuses?: readonly SettingsSubmissionStatus[];
  }) => void;
  list: (owner: PendingSettingsOwnerIdentity) => SettingsSubmissionEntry[];
  reject: (input: {
    entries: readonly SettingsSubmissionEntry[];
    error: unknown;
    owner: PendingSettingsOwnerIdentity;
  }) => SettingsSubmissionEntry[];
  snapshot: () => readonly SettingsSubmissionEntry[];
  start: <TDraft, TTarget>(input: {
    baseDraft: TDraft;
    draft: TDraft;
    owner: PendingSettingsOwnerIdentity;
    updates: readonly SettingsSubmissionDomainUpdate<TTarget>[];
  }) => SettingsSubmissionStartResult<TDraft, TTarget>;
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_SUBMISSION_ENTRIES: readonly SettingsSubmissionEntry[] = [];

function defaultId() {
  if (globalThis.crypto?.randomUUID != null) {
    return globalThis.crypto.randomUUID();
  }
  return `submission-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "Update failed.";
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

export function sameSettingsSubmissionOwner(
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

function sameOwnerDomain(
  entry: SettingsSubmissionEntry,
  owner: PendingSettingsOwnerIdentity,
  domain: string
) {
  return sameSettingsSubmissionOwner(entry, owner) && entry.domain === domain;
}

function uniqueDomains(
  updates: readonly SettingsSubmissionDomainUpdate[]
): string[] {
  return [
    ...new Set(
      updates
        .map((update) => update.domain.trim())
        .filter((domain) => domain !== "")
    ),
  ];
}

export function createSettingsSubmissionStore({
  id = defaultId,
  now = () => Date.now(),
}: {
  id?: () => string;
  now?: () => number;
} = {}): SettingsSubmissionStore {
  let entries: readonly SettingsSubmissionEntry[] = EMPTY_SUBMISSION_ENTRIES;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const replaceEntries = (nextEntries: readonly SettingsSubmissionEntry[]) => {
    entries = nextEntries;
    notify();
  };

  return {
    accept({ entries: acceptedEntries, owner, pendingStore }) {
      const acceptedIds = new Set(acceptedEntries.map((entry) => entry.id));
      const accepted = entries.filter(
        (entry) =>
          acceptedIds.has(entry.id) &&
          entry.status === "submitting" &&
          sameSettingsSubmissionOwner(entry, owner)
      );
      if (accepted.length === 0) {
        return [];
      }

      const pendingEntries =
        pendingStore?.replaceDirtyDomains({
          owner,
          updates: accepted.map((entry) => ({
            domain: entry.domain,
            submittedAgainst: entry.submittedAgainst,
            target: entry.target,
          })),
        }) ?? [];
      replaceEntries(entries.filter((entry) => !acceptedIds.has(entry.id)));
      return pendingEntries;
    },
    clear({ domains, owner, statuses }) {
      const domainSet = domains == null ? null : new Set(domains);
      const statusSet = statuses == null ? null : new Set(statuses);
      const nextEntries = entries.filter((entry) => {
        if (!sameSettingsSubmissionOwner(entry, owner)) {
          return true;
        }
        if (domainSet != null && !domainSet.has(entry.domain)) {
          return true;
        }
        if (statusSet != null && !statusSet.has(entry.status)) {
          return true;
        }
        return false;
      });
      if (nextEntries.length !== entries.length) {
        replaceEntries(nextEntries);
      }
    },
    list(owner) {
      return entries.filter((entry) =>
        sameSettingsSubmissionOwner(entry, owner)
      );
    },
    reject({ entries: rejectedEntries, error, owner }) {
      const rejectedIds = new Set(rejectedEntries.map((entry) => entry.id));
      const message = errorMessage(error);
      const rejected: SettingsSubmissionEntry[] = [];
      let changed = false;
      const nextEntries = entries.map((entry) => {
        if (
          !rejectedIds.has(entry.id) ||
          entry.status !== "submitting" ||
          !sameSettingsSubmissionOwner(entry, owner)
        ) {
          return entry;
        }
        changed = true;
        const nextEntry = {
          ...entry,
          errorMessage: message,
          status: "rejected" as const,
        };
        rejected.push(nextEntry);
        return nextEntry;
      });
      if (changed) {
        replaceEntries(nextEntries);
      }
      return rejected;
    },
    snapshot() {
      return entries;
    },
    start({ baseDraft, draft, owner, updates }) {
      const domains = uniqueDomains(updates);
      if (domains.length === 0) {
        return { entries: [], status: "started" };
      }

      const blockedDomains = domains.filter((domain) =>
        entries.some(
          (entry) =>
            entry.status === "submitting" &&
            sameOwnerDomain(entry, owner, domain)
        )
      );
      if (blockedDomains.length > 0) {
        return { domains: blockedDomains, status: "blocked" };
      }

      const updatesByDomain = new Map(
        updates.map((update) => [update.domain.trim(), update])
      );
      const submittedAtMs = now();
      const submissionId = id();
      const startedEntries = domains.map((domain) => {
        const update = updatesByDomain.get(domain);
        if (update == null) {
          throw new Error("Settings submission update is missing a domain.");
        }
        return {
          ...owner,
          baseDraft,
          domain,
          draft,
          id: `${submissionId}:${domain}`,
          status: "submitting" as const,
          submissionId,
          submittedAgainst: update.submittedAgainst,
          submittedAtMs,
          target: update.target,
        };
      });
      replaceEntries([
        ...entries.filter(
          (entry) =>
            !domains.some((domain) => sameOwnerDomain(entry, owner, domain))
        ),
        ...startedEntries,
      ]);
      return { entries: startedEntries, status: "started" };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let browserSettingsSubmissionStore: SettingsSubmissionStore | null | undefined;

export function getBrowserSettingsSubmissionStore(): SettingsSubmissionStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  browserSettingsSubmissionStore ??= createSettingsSubmissionStore();
  return browserSettingsSubmissionStore;
}

export function useSettingsSubmissionEntries(
  owner: PendingSettingsOwnerIdentity | null | undefined,
  store: SettingsSubmissionStore | null
): readonly SettingsSubmissionEntry[] {
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.snapshot ?? (() => EMPTY_SUBMISSION_ENTRIES),
    () => EMPTY_SUBMISSION_ENTRIES
  );

  return useMemo(() => {
    if (owner == null) {
      return EMPTY_SUBMISSION_ENTRIES;
    }
    return snapshot.filter((entry) =>
      sameSettingsSubmissionOwner(entry, owner)
    );
  }, [owner, snapshot]);
}

export function latestRejectedSettingsSubmission<TDraft>(
  entries: readonly SettingsSubmissionEntry[]
): SettingsSubmissionRecovery<TDraft> | null {
  const rejected = entries
    .filter((entry) => entry.status === "rejected")
    .sort((left, right) => right.submittedAtMs - left.submittedAtMs);
  const latest = rejected[0];
  if (latest == null) {
    return null;
  }
  const group = rejected.filter(
    (entry) => entry.submissionId === latest.submissionId
  );
  return {
    baseDraft: latest.baseDraft as TDraft,
    domains: group.map((entry) => entry.domain),
    draft: latest.draft as TDraft,
    errorMessage: latest.errorMessage,
    submissionId: latest.submissionId,
    submittedAtMs: latest.submittedAtMs,
  };
}
