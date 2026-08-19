import assert from "node:assert/strict";
import { test } from "node:test";

import {
  billingTableBodyState,
  reconcileAppTypeFilter,
  reconcileCostScope,
} from "./billing-costs-state";

test("a billing table only reads as empty once every feeding request resolved with zero rows", () => {
  // The base snapshot resolving after the overview page must not surface a
  // definitive "No Data Available" — loading wins over everything.
  assert.equal(
    billingTableBodyState({ hasError: false, isLoading: true, rowCount: 0 }),
    "loading"
  );
  assert.equal(
    billingTableBodyState({ hasError: true, isLoading: true, rowCount: 0 }),
    "loading"
  );
  // A failed request is an error state, not an empty one — even with zero
  // rows in hand.
  assert.equal(
    billingTableBodyState({ hasError: true, isLoading: false, rowCount: 0 }),
    "error"
  );
  assert.equal(
    billingTableBodyState({ hasError: true, isLoading: false, rowCount: 3 }),
    "error"
  );
  assert.equal(
    billingTableBodyState({ hasError: false, isLoading: false, rowCount: 0 }),
    "empty"
  );
  assert.equal(
    billingTableBodyState({ hasError: false, isLoading: false, rowCount: 2 }),
    "rows"
  );
});

test("a workspace scope absent from the resolved range falls back to the region scope", () => {
  const workspaces: [string, string][] = [
    ["ws-alpha", "alpha"],
    ["ws-beta", "beta"],
  ];
  const kept = { kind: "workspace", workspace: "ws-alpha" } as const;
  // Still listed: the very same scope object comes back, so callers can use
  // identity to detect "nothing to reconcile".
  assert.equal(reconcileCostScope(kept, workspaces), kept);
  assert.deepEqual(
    reconcileCostScope({ kind: "workspace", workspace: "ws-gone" }, workspaces),
    { kind: "region" }
  );
  // Non-workspace scopes never reconcile.
  const region = { kind: "region" } as const;
  const total = { kind: "total" } as const;
  assert.equal(reconcileCostScope(region, []), region);
  assert.equal(reconcileCostScope(total, []), total);
});

test("an app-type filter absent from the resolved catalog falls back to All", () => {
  const appTypes = { "1": "DB", "10": "DEV-BOX" };
  assert.equal(reconcileAppTypeFilter("DEV-BOX", appTypes), "DEV-BOX");
  assert.equal(reconcileAppTypeFilter("CLOUD-VM", appTypes), null);
  assert.equal(reconcileAppTypeFilter(null, appTypes), null);
  assert.equal(reconcileAppTypeFilter("DB", {}), null);
});
