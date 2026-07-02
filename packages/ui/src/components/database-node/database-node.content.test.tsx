import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DatabaseNodeContent } from "./database-node.content";
import { DatabaseNodeRoot } from "./database-node.root";

const DATABASE_STATES = {
  displayEngine: "PostgreSQL",
  name: "postgres",
  status: { label: "Running", tone: "running" },
} as const;
const OPEN_DATABASE_ACTIONS_RE = /Open database actions/;

test("DatabaseNodeContent omits lifecycle menu without a family", () => {
  const html = renderToStaticMarkup(
    <DatabaseNodeRoot states={DATABASE_STATES}>
      <DatabaseNodeContent />
    </DatabaseNodeRoot>
  );

  assert.doesNotMatch(html, OPEN_DATABASE_ACTIONS_RE);
});

test("DatabaseNodeContent keeps disabled lifecycle family discoverable", () => {
  const html = renderToStaticMarkup(
    <DatabaseNodeRoot
      lifecycleActions={{
        delete: {
          disabled: true,
          disabledReason: "This project is read-only.",
        },
        restart: {
          disabled: true,
          disabledReason: "This project is read-only.",
        },
        stop: {
          disabled: true,
          disabledReason: "This project is read-only.",
        },
      }}
      states={DATABASE_STATES}
    >
      <DatabaseNodeContent />
    </DatabaseNodeRoot>
  );

  assert.match(html, OPEN_DATABASE_ACTIONS_RE);
});
