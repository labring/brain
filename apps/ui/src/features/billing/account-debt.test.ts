import assert from "node:assert/strict";
import { test } from "node:test";

import { accountDebtByOwner } from "./account-debt";

test("the Owner's own empty wallet is the workspace's debt", () => {
  assert.equal(
    accountDebtByOwner({
      money: true,
      owner: { isOwner: true, platformDebt: false },
    }),
    true
  );
});

test("a member's empty wallet says nothing about a workspace they do not own", () => {
  assert.equal(
    accountDebtByOwner({
      money: true,
      owner: { isOwner: false, platformDebt: false },
    }),
    false
  );
});

test("the platform's suspension mark is debt whoever is looking", () => {
  assert.equal(
    accountDebtByOwner({
      money: false,
      owner: { isOwner: false, platformDebt: true },
    }),
    true
  );
  assert.equal(
    accountDebtByOwner({
      money: null,
      owner: { isOwner: null, platformDebt: true },
    }),
    true
  );
});

test("an unknown owner without a mark is unknown debt, not the caller's balance", () => {
  assert.equal(
    accountDebtByOwner({
      money: true,
      owner: { isOwner: null, platformDebt: null },
    }),
    null
  );
  assert.equal(
    accountDebtByOwner({
      money: true,
      owner: { isOwner: null, platformDebt: false },
    }),
    false
  );
});

test("the Owner with an unread balance and no mark is unknown", () => {
  assert.equal(
    accountDebtByOwner({
      money: null,
      owner: { isOwner: true, platformDebt: false },
    }),
    null
  );
});
