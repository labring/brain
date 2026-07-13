import assert from "node:assert/strict";
import { test } from "node:test";

import {
  columnResizePreview,
  columnWidthCssProperty,
  columnWidthDuringResize,
  columnWidthRootStyle,
  columnWidthStyle,
  defaultColumnWidth,
} from "./useColumnResize";

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

test("resize guide stays on the rendered boundary when grabbed inside its handle", () => {
  assert.deepEqual(
    columnResizePreview({ startWidth: 120, startX: 100 }, 102, 150),
    { boundaryClientX: 152, width: 170 }
  );
});

test("resize guide stops when the column reaches its minimum width", () => {
  assert.deepEqual(
    columnResizePreview({ startWidth: 120, startX: 100 }, 102, 20),
    { boundaryClientX: 42, width: 60 }
  );
});

test("every column has one root-scoped width before its first drag", () => {
  const committedWidths = new Map([["email", 240]]);

  assert.deepEqual(
    columnWidthRootStyle(
      ["id", "email"],
      (column) => committedWidths.get(column) ?? null
    ),
    {
      "--db-access-column-0-width": "120px",
      "--db-access-column-1-width": "240px",
    }
  );
  assert.equal(columnWidthCssProperty(2), "--db-access-column-2-width");
  assert.deepEqual(columnWidthStyle("email", 2), {
    maxWidth: "var(--db-access-column-2-width, none)",
    minWidth: "var(--db-access-column-2-width, 120px)",
  });
});
