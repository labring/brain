import assert from "node:assert/strict";
import { test } from "node:test";

import { SESSION_SWR_KEYS, type SessionCredentials } from "./swr-keys";

const BASE: SessionCredentials = {
  appToken: "app-token-a",
  kubeconfig: "apiVersion: v1\ncurrent-context: a\n",
  namespace: "ns-a",
  regionalToken: "regional-a",
};

const VARIANTS: Record<keyof SessionCredentials, SessionCredentials> = {
  appToken: { ...BASE, appToken: "app-token-b" },
  kubeconfig: { ...BASE, kubeconfig: "apiVersion: v1\ncurrent-context: b\n" },
  namespace: { ...BASE, namespace: "ns-b" },
  regionalToken: { ...BASE, regionalToken: "regional-b" },
};

// Spec §A.9: every client cache key derives from the credential atoms, so an
// in-place session re-establish invalidates every cache. Walk every key
// constructor and prove each credential is part of each key.
test("every session SWR key changes when any one credential changes", () => {
  for (const [name, build] of Object.entries(SESSION_SWR_KEYS)) {
    const base = JSON.stringify(build(BASE));
    assert.equal(JSON.stringify(build({ ...BASE })), base, `${name} is stable`);
    for (const [credential, variant] of Object.entries(VARIANTS)) {
      assert.notEqual(
        JSON.stringify(build(variant)),
        base,
        `${name} ignores ${credential}`
      );
    }
  }
});

test("keys keep their prefix as the first element for the dev-mock matchers", () => {
  assert.equal(
    SESSION_SWR_KEYS.appSidebarSubscription(BASE)[0],
    "app-sidebar-subscription"
  );
  assert.equal(
    SESSION_SWR_KEYS.notificationsFeed(BASE)[0],
    "notifications-feed"
  );
  assert.equal(SESSION_SWR_KEYS.statusHintQuota(BASE)[0], "status-hint-quota");
});
