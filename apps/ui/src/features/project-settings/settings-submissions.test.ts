import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPendingSettingsStore,
  PENDING_SETTINGS_STORAGE_KEY,
} from "./pending-settings-updates";
import {
  createSettingsSubmissionStore,
  latestRejectedSettingsSubmission,
} from "./settings-submissions";

const RESOURCES_DOMAIN_ENTRY_RE = /"domain":"resources"/;

class MemoryStorage
  implements Pick<Storage, "getItem" | "removeItem" | "setItem">
{
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const owner = {
  clusterFingerprint: "stable:cluster",
  kind: "ap" as const,
  name: "api",
  namespace: "demo",
  uid: "ap-uid-1",
};

test("settings submission blocks overlapping in-flight owner domains", () => {
  let nextId = 1;
  const store = createSettingsSubmissionStore({
    id: () => `submission-${nextId++}`,
    now: () => 12_345,
  });

  const started = store.start({
    baseDraft: { image: "v1" },
    draft: { image: "v2" },
    owner,
    updates: [
      {
        domain: "launch",
        submittedAgainst: { image: "v1" },
        target: { image: "v2" },
      },
    ],
  });

  assert.equal(started.status, "started");
  assert.equal(store.list(owner).length, 1);

  const blocked = store.start({
    baseDraft: { image: "v2" },
    draft: { image: "v3" },
    owner,
    updates: [
      {
        domain: "launch",
        submittedAgainst: { image: "v2" },
        target: { image: "v3" },
      },
    ],
  });

  assert.deepEqual(blocked, {
    domains: ["launch"],
    status: "blocked",
  });
});

test("accepted settings submission writes pending updates and clears submission", () => {
  const pendingStorage = new MemoryStorage();
  const pendingStore = createPendingSettingsStore({
    now: () => 20_000,
    storage: pendingStorage,
  });
  const submissionStore = createSettingsSubmissionStore({
    id: () => "submission-1",
    now: () => 10_000,
  });
  const started = submissionStore.start({
    baseDraft: { replicas: 1 },
    draft: { replicas: 2 },
    owner,
    updates: [
      {
        domain: "resources",
        submittedAgainst: { replicas: 1 },
        target: { replicas: 2 },
      },
    ],
  });

  assert.equal(started.status, "started");
  if (started.status !== "started") {
    return;
  }

  const pendingEntries = submissionStore.accept({
    entries: started.entries,
    owner,
    pendingStore,
  });

  assert.deepEqual(submissionStore.list(owner), []);
  assert.equal(pendingEntries.length, 1);
  assert.deepEqual(pendingStore.list(owner)[0]?.target, { replicas: 2 });
  assert.match(
    pendingStorage.getItem(PENDING_SETTINGS_STORAGE_KEY) ?? "",
    RESOURCES_DOMAIN_ENTRY_RE
  );
});

test("rejected settings submission remains session-only for recovery", () => {
  const pendingStorage = new MemoryStorage();
  const pendingStore = createPendingSettingsStore({ storage: pendingStorage });
  const submissionStore = createSettingsSubmissionStore({
    id: () => "submission-1",
    now: () => 10_000,
  });
  const started = submissionStore.start({
    baseDraft: { exposeNodePort: false },
    draft: { exposeNodePort: true },
    owner: { ...owner, kind: "database" as const, name: "postgres" },
    updates: [
      {
        domain: "access",
        submittedAgainst: { exposeNodePort: false },
        target: { exposeNodePort: true },
      },
    ],
  });

  assert.equal(started.status, "started");
  if (started.status !== "started") {
    return;
  }

  const dbOwner = { ...owner, kind: "database" as const, name: "postgres" };
  submissionStore.reject({
    entries: started.entries,
    error: new Error("network timeout"),
    owner: dbOwner,
  });

  const recovery = latestRejectedSettingsSubmission(
    submissionStore.list(dbOwner)
  );
  assert.deepEqual(recovery?.draft, { exposeNodePort: true });
  assert.equal(recovery?.errorMessage, "network timeout");
  assert.equal(pendingStore.list(dbOwner).length, 0);
  assert.equal(pendingStorage.getItem(PENDING_SETTINGS_STORAGE_KEY), null);
});
