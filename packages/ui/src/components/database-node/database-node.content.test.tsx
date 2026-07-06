import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DatabaseNodeContent,
  DatabaseNodeDeletionDelayHint,
} from "./database-node.content";
import { DatabaseNodeRoot } from "./database-node.root";

const DATABASE_STATES = {
  displayEngine: "PostgreSQL",
  name: "postgres",
  status: { label: "Running", tone: "running" },
} as const;
const OPEN_DATABASE_ACTIONS_RE = /Open database actions/;
const DATABASE_NOT_RUNNING_RE = /Database is not running\./;
const READ_ONLY_REASON_RE = /This project is read-only\./;
const FIXED_CONNECTION_MASK_RE = />\*{12}</;
const HOVER_REVEALED_CONNECTION_RE =
  /class="[^"]*\bhidden\b[^"]*\bgroup-hover\/copyable-row:inline\b[^"]*"[^>]*>postgresql:\/\/alice:s3cr3t@db-main-postgresql.ns-a.svc:5432\/postgres</;
const FIXED_CONNECTION_MASK_TITLE_RE = /title="\*{12}"/;
const RAW_CONNECTION_TITLE_RE =
  /title="postgresql:\/\/alice:s3cr3t@db-main-postgresql.ns-a.svc:5432\/postgres"/;
const PARTIAL_CONNECTION_MASK_RE =
  /postgresql:\/\/a\*\*\*\*\*\*\*:\*\*\*\*\*\*\*@db-main-postgresql/;
const DELETION_DELAY_HINT_RE =
  /Your database is being deleted\. This may take a few minutes\./;
const DELETION_DELAY_HINT_SLOT_RE =
  /data-slot="database-node-deletion-delay-hint"/;

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

test("DatabaseNodeContent gates live sessions while stopped", () => {
  const html = renderToStaticMarkup(
    <DatabaseNodeRoot
      quickActions={{
        dbAccess: { onClick: () => undefined },
        terminal: { onClick: () => undefined },
      }}
      states={{
        ...DATABASE_STATES,
        status: { label: "Stopped", tone: "stopped" },
      }}
    >
      <DatabaseNodeContent />
    </DatabaseNodeRoot>
  );

  assert.match(html, DATABASE_NOT_RUNNING_RE);
});

test("DatabaseNodeContent explains the unavailable public access toggle", () => {
  const html = renderToStaticMarkup(
    <DatabaseNodeRoot
      connections={[
        {
          id: "public",
          kind: "public",
          label: "Public connection",
          publicAccess: { enabled: true },
          value: "postgresql://user:pass@example.com:5432/app",
        },
      ]}
      states={DATABASE_STATES}
      togglePublicConnectionDisabledReason="This project is read-only."
    >
      <DatabaseNodeContent />
    </DatabaseNodeRoot>
  );

  assert.match(html, READ_ONLY_REASON_RE);
});

test("DatabaseNodeContent hides connection strings until the row is hovered", () => {
  const html = renderToStaticMarkup(
    <DatabaseNodeRoot
      connections={[
        {
          id: "private",
          kind: "private",
          label: "Private connection",
          value:
            "postgresql://alice:s3cr3t@db-main-postgresql.ns-a.svc:5432/postgres",
        },
      ]}
      states={DATABASE_STATES}
    >
      <DatabaseNodeContent />
    </DatabaseNodeRoot>
  );

  assert.match(html, FIXED_CONNECTION_MASK_RE);
  assert.match(html, HOVER_REVEALED_CONNECTION_RE);
  assert.doesNotMatch(html, FIXED_CONNECTION_MASK_TITLE_RE);
  assert.doesNotMatch(html, RAW_CONNECTION_TITLE_RE);
  assert.doesNotMatch(html, PARTIAL_CONNECTION_MASK_RE);
});

test("DatabaseNodeDeletionDelayHint renders the Figma-specified message", () => {
  const html = renderToStaticMarkup(<DatabaseNodeDeletionDelayHint />);

  assert.match(html, DELETION_DELAY_HINT_SLOT_RE);
  assert.match(html, DELETION_DELAY_HINT_RE);
});
