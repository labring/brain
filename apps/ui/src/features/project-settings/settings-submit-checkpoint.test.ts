import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSettingsSubmitCheckpointStore,
  SETTINGS_SUBMIT_CHECKPOINT_STORAGE_KEY,
} from "./settings-submit-checkpoint";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("settings submit checkpoint stores a recoverable submitted draft", () => {
  const storage = memoryStorage();
  const store = createSettingsSubmitCheckpointStore({
    now: () => 12_345,
    storage,
  });

  store.start({
    base: { replicas: 1 },
    draft: { replicas: 2 },
    ownerKey: "ap:default:web",
  });

  assert.deepEqual(store.get("ap:default:web"), {
    base: { replicas: 1 },
    draft: { replicas: 2 },
    ownerKey: "ap:default:web",
    status: "submitting",
    submittedAtMs: 12_345,
    version: 1,
  });
});

test("settings submit checkpoint replaces existing owner checkpoint", () => {
  const store = createSettingsSubmitCheckpointStore({
    now: () => 1,
    storage: memoryStorage(),
  });

  store.start({
    base: { image: "v1" },
    draft: { image: "v2" },
    ownerKey: "ap:default:web",
  });
  store.start({
    base: { image: "v2" },
    draft: { image: "v3" },
    ownerKey: "ap:default:web",
  });

  assert.deepEqual(store.get("ap:default:web")?.draft, { image: "v3" });
});

test("settings submit checkpoint can mark a submitted draft as failed", () => {
  const store = createSettingsSubmitCheckpointStore({
    now: () => 1,
    storage: memoryStorage(),
  });

  store.start({
    base: { exposeNodePort: false },
    draft: { exposeNodePort: true },
    ownerKey: "database:default:postgres",
  });

  const failed = store.fail(
    "database:default:postgres",
    new Error("network timeout")
  );

  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorMessage, "network timeout");
  assert.equal(store.get("database:default:postgres")?.status, "failed");
});

test("settings submit checkpoint clears storage when empty", () => {
  const storage = memoryStorage();
  const store = createSettingsSubmitCheckpointStore({ storage });

  store.start({
    base: { replicas: 1 },
    draft: { replicas: 2 },
    ownerKey: "ap:default:web",
  });
  store.clear("ap:default:web");

  assert.equal(storage.getItem(SETTINGS_SUBMIT_CHECKPOINT_STORAGE_KEY), null);
});
