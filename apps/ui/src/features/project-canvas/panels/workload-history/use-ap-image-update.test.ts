import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ApPendingLaunchTarget,
  apPendingTargetsEqual,
} from "@/features/resource-settings/ap/ap-pending-settings";
import {
  classifyPendingSettingsEntry,
  createPendingSettingsStore,
  PENDING_SETTINGS_SCHEMA_VERSION,
  type PendingSettingsUpdateEntry,
} from "@/features/resource-settings/pending-settings-updates";

import { launchPendingUpdateForImage } from "./use-ap-image-update";

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

const OWNER = {
  clusterFingerprint: "sha256:cluster",
  kind: "ap" as const,
  name: "api",
  namespace: "demo",
  uid: "ap-uid-1",
};

function launchTarget(
  image: string,
  command: readonly string[] = ["/app/server"]
): ApPendingLaunchTarget {
  return {
    args: [],
    command,
    configMaps: [],
    image,
    storage: [],
  };
}

const launchEquals = (left: unknown, right: unknown) =>
  apPendingTargetsEqual(
    "launch",
    left as ApPendingLaunchTarget,
    right as ApPendingLaunchTarget
  );

test("image submit with no in-flight update baselines against observed", () => {
  const observed = launchTarget("ghcr.io/acme/api:1.0.0");

  const update = launchPendingUpdateForImage({
    image: "ghcr.io/acme/api:2.0.0",
    observed,
  });

  assert.equal(update.domain, "launch");
  assert.deepEqual(update.submittedAgainst, observed);
  assert.deepEqual(update.target, {
    ...observed,
    image: "ghcr.io/acme/api:2.0.0",
  });
});

test("image submit merges into an in-flight launch target instead of rebuilding from observed", () => {
  // AP Settings submitted a command change that has not reconciled yet:
  // observed still runs the old command while the entry targets the new one.
  const submittedAgainst = launchTarget("ghcr.io/acme/api:1.0.0", [
    "/app/server",
  ]);
  const inFlight: PendingSettingsUpdateEntry<ApPendingLaunchTarget> = {
    ...OWNER,
    domain: "launch",
    submittedAgainst,
    submittedAtMs: 1000,
    target: launchTarget("ghcr.io/acme/api:1.0.0", ["/app/server", "--v2"]),
    version: PENDING_SETTINGS_SCHEMA_VERSION,
  };

  const update = launchPendingUpdateForImage({
    image: "ghcr.io/acme/api:2.0.0",
    inFlight,
    observed: submittedAgainst,
  });

  assert.deepEqual(update.target.command, ["/app/server", "--v2"]);
  assert.equal(update.target.image, "ghcr.io/acme/api:2.0.0");
  assert.deepEqual(update.submittedAgainst, inFlight.submittedAgainst);
});

test("update then rollback: clearing the owner makes classification follow the snapshot", () => {
  const storage = new MemoryStorage();
  const store = createPendingSettingsStore({ now: () => 1000, storage });
  const snapshot = launchTarget("ghcr.io/acme/api:1.0.0");

  // Inline Update 1.0.0 -> 2.0.0, plus an unrelated pending domain to show
  // rollback clears across domains, not just launch.
  store.replaceDirtyDomains({
    owner: OWNER,
    updates: [
      launchPendingUpdateForImage({
        image: "ghcr.io/acme/api:2.0.0",
        observed: snapshot,
      }),
      {
        domain: "resources",
        submittedAgainst: { cpuCores: 1, memoryMib: 512 },
        target: { cpuCores: 2, memoryMib: 1024 },
      },
    ],
  });

  // Rollback restores the previous version, so observed equals the entry's
  // submittedAgainst again. A surviving entry misclassifies the resource as
  // still applying the 2.0.0 update — the trap the clearing prevents.
  const launchEntry = store
    .list(OWNER)
    .find((entry) => entry.domain === "launch");
  assert.ok(launchEntry);
  assert.equal(
    classifyPendingSettingsEntry(launchEntry, {
      equals: launchEquals,
      now: () => 2000,
      observed: snapshot,
    }).status,
    "applying"
  );

  // What a successful rollback now does (clearPendingAfterRollback): with no
  // pending entry left, the surface's baseline is the observed snapshot image.
  store.clearOwner(OWNER);
  assert.deepEqual(store.list(OWNER), []);
});
