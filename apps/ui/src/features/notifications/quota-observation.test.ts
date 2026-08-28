import { test } from "bun:test";
import assert from "node:assert/strict";

import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";

import type { NotificationClientCredentials } from "./client";
import {
  observeWorkspaceQuotaForInbox,
  type WorkspaceQuotaObservationDependencies,
} from "./quota-observation";

const CREDENTIALS: NotificationClientCredentials = {
  appToken: "token",
  kubeconfig: "kubeconfig",
  namespace: "ns-a",
};

const SNAPSHOT: WorkspaceResourceQuotaSnapshot = {
  items: [{ limit: 10, type: "cpu", used: 10 }],
};

function dependencies(
  overrides: Partial<WorkspaceQuotaObservationDependencies> = {}
) {
  const calls = {
    loaded: [] as string[],
    refreshed: 0,
    reported: [] as {
      credentials: NotificationClientCredentials;
      snapshot: WorkspaceResourceQuotaSnapshot;
    }[],
  };
  const deps: WorkspaceQuotaObservationDependencies = {
    loadSnapshot: (namespace) => {
      calls.loaded.push(namespace);
      return Promise.resolve(SNAPSHOT);
    },
    refreshFeed: () => {
      calls.refreshed += 1;
      return Promise.resolve();
    },
    report: (credentials, snapshot) => {
      calls.reported.push({ credentials, snapshot });
      return Promise.resolve();
    },
    ...overrides,
  };
  return { calls, deps };
}

test("a read snapshot is reported for the workspace and the inbox is refreshed", async () => {
  const { calls, deps } = dependencies();

  assert.equal(await observeWorkspaceQuotaForInbox(CREDENTIALS, deps), true);
  assert.deepEqual(calls.loaded, ["ns-a"]);
  assert.deepEqual(calls.reported, [
    { credentials: CREDENTIALS, snapshot: SNAPSHOT },
  ]);
  assert.equal(calls.refreshed, 1);
});

test("missing credentials or an empty snapshot report nothing", async () => {
  let loads = 0;
  const { calls, deps } = dependencies({
    loadSnapshot: () => {
      loads += 1;
      return Promise.resolve(undefined);
    },
  });

  assert.equal(
    await observeWorkspaceQuotaForInbox({ ...CREDENTIALS, appToken: "" }, deps),
    false
  );
  assert.equal(loads, 0, "no credentials, no read");
  assert.equal(await observeWorkspaceQuotaForInbox(CREDENTIALS, deps), false);
  assert.equal(loads, 1);
  assert.equal(calls.reported.length, 0);
  assert.equal(calls.refreshed, 0);
});

test("a failed read or report resolves false without throwing and never refreshes", async () => {
  const readFailed = dependencies({
    loadSnapshot: () => Promise.reject(new Error("sdk down")),
  });
  const reportFailed = dependencies({
    report: () => Promise.reject(new Error("503")),
  });

  assert.equal(
    await observeWorkspaceQuotaForInbox(CREDENTIALS, readFailed.deps),
    false
  );
  assert.equal(
    await observeWorkspaceQuotaForInbox(CREDENTIALS, reportFailed.deps),
    false
  );
  assert.equal(readFailed.calls.refreshed, 0);
  assert.equal(reportFailed.calls.refreshed, 0);
});
