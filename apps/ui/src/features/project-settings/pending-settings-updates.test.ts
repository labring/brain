import assert from "node:assert/strict";
import { test } from "node:test";
import type { PendingSettingsUpdateEntry } from "@/features/project-settings/pending-settings-updates";
import {
  classifyPendingSettingsEntry,
  createPendingSettingsStore,
  PENDING_SETTINGS_ATTENTION_WINDOW_MS,
  PENDING_SETTINGS_SCHEMA_VERSION,
  pendingSettingsClusterFingerprint,
} from "@/features/project-settings/pending-settings-updates";

const SECRET_TOKEN_RE = /secret-token/;

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

test("pending settings store persists versioned dirty-domain entries without raw kubeconfig", async () => {
  const storage = new MemoryStorage();
  const rawKubeconfig = "cluster: prod\nuser: admin\nsecret-token";
  const clusterFingerprint =
    await pendingSettingsClusterFingerprint(rawKubeconfig);
  const store = createPendingSettingsStore({
    now: () => 1000,
    storage,
  });
  const owner = {
    clusterFingerprint,
    kind: "ap" as const,
    name: "api",
    namespace: "demo",
    uid: "ap-uid-1",
  };

  store.replaceDirtyDomains({
    owner,
    submittedAgainstByDomain: {
      network: { privatePort: 3000 },
    },
    targetByDomain: {
      network: { privatePort: 8080 },
    },
  });

  const entries = store.list(owner);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.version, PENDING_SETTINGS_SCHEMA_VERSION);
  assert.equal(entries[0]?.domain, "network");
  assert.deepEqual(entries[0]?.target, { privatePort: 8080 });
  assert.equal(entries[0]?.submittedAtMs, 1000);

  const rawStorage = [...storage.values.values()].join("\n");
  assert.doesNotMatch(rawStorage, SECRET_TOKEN_RE);
  assert.match(rawStorage, new RegExp(clusterFingerprint));

  assert.deepEqual(store.list({ ...owner, uid: "ap-uid-2" }), []);
});

test("pending settings classification separates applying, attention, reconciliation, and divergence", () => {
  const entry: PendingSettingsUpdateEntry<{ replicas: number }> = {
    clusterFingerprint: "sha256:cluster",
    domain: "resources",
    kind: "database" as const,
    name: "postgres",
    namespace: "demo",
    submittedAgainst: { replicas: 1 },
    submittedAtMs: 1000,
    target: { replicas: 2 },
    uid: "db-uid-1",
    version: PENDING_SETTINGS_SCHEMA_VERSION,
  };
  const equals = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);

  assert.equal(
    classifyPendingSettingsEntry(entry, {
      equals,
      now: () => 1000 + PENDING_SETTINGS_ATTENTION_WINDOW_MS - 1,
      observed: { replicas: 1 },
    }).status,
    "applying"
  );
  assert.equal(
    classifyPendingSettingsEntry(entry, {
      equals,
      now: () => 1000 + PENDING_SETTINGS_ATTENTION_WINDOW_MS,
      observed: { replicas: 1 },
    }).status,
    "attention-needed"
  );
  assert.equal(
    classifyPendingSettingsEntry(entry, {
      equals,
      observed: { replicas: 2 },
    }).status,
    "reconciled"
  );
  assert.equal(
    classifyPendingSettingsEntry(entry, {
      equals,
      observed: { replicas: 3 },
    }).status,
    "diverged"
  );
});
