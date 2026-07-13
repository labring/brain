import assert from "node:assert/strict";
import { test } from "node:test";

import { columnWidthDuringResize, defaultColumnWidth } from "./useColumnResize";

test("column width defaults preserve the existing name-based sizing", () => {
  assert.equal(defaultColumnWidth("id"), 120);
  assert.equal(defaultColumnWidth("customer_email_address"), 280);
});

test("column resize preserves the existing 60px minimum", () => {
  assert.equal(
    columnWidthDuringResize({ startWidth: 120, startX: 100 }, 20),
    60
  );
  assert.equal(
    columnWidthDuringResize({ startWidth: 120, startX: 100 }, 150),
    170
  );
});
