import assert from "node:assert/strict";
import { test } from "node:test";

import { billingTableBodyState } from "./billing-costs-state";

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
