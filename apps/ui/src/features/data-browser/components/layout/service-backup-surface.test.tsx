import assert from "node:assert/strict";
import { test } from "node:test";

import type { DataBrowserHostContext } from "@data-browser/api/access-types";
import { DbAccessSessionProvider } from "@data-browser/state/db-access-session";
import { renderToStaticMarkup } from "react-dom/server";
import { MainLayout } from "./MainLayout";

const runtime = {
  backups: [
    {
      metadata: {
        creationTimestamp: "2026-06-09T05:00:00Z",
        name: "orders-manual-20260609",
        namespace: "database-system",
      },
      status: {
        completionTimestamp: "2026-06-09T05:03:00Z",
        phase: "Completed",
        startTimestamp: "2026-06-09T05:00:00Z",
      },
    },
  ],
  database: {
    displayEngine: "PostgreSQL",
    formattedVersion: "16.4",
    name: "orders",
  },
  dbService: {
    name: "orders-db",
    namespace: "database-system",
    uid: "cluster-uid-1",
  },
  dbServicePhase: "Running",
  databaseWorkloadName: "orders-db",
  databaseWorkloadNamespace: "database-system",
  engine: "POSTGRES",
  kubeconfig: "kube",
  namespace: "project-ns",
  projectId: "project-uid",
} satisfies DataBrowserHostContext;

function assertDefaultSecondaryButton(
  html: string,
  ...attributePatterns: string[]
) {
  const attributeLookaheads = attributePatterns
    .map((pattern) => `(?=[^>]*${pattern})`)
    .join("");
  assert.match(
    html,
    new RegExp(
      `<button${attributeLookaheads}(?=[^>]*data-size="default")(?=[^>]*data-variant="secondary")[^>]*>`
    )
  );
}

function assertDangerIconButton(html: string, ...attributePatterns: string[]) {
  const attributeLookaheads = attributePatterns
    .map((pattern) => `(?=[^>]*${pattern})`)
    .join("");
  assert.match(
    html,
    new RegExp(
      `<button${attributeLookaheads}(?=[^>]*data-size="lg")(?=[^>]*data-slot="app-icon-button")(?=[^>]*data-variant="danger")[^>]*>`
    )
  );
}

function elementClassName(
  html: string,
  tagName: string,
  ...attributePatterns: string[]
) {
  const attributeLookaheads = attributePatterns
    .map((pattern) => `(?=[^>]*${pattern})`)
    .join("");
  const match = new RegExp(
    `<${tagName}${attributeLookaheads}[^>]*class="([^"]*)"[^>]*>`
  ).exec(html);
  if (match?.[1] === undefined) {
    assert.fail(`Expected ${tagName} with ${attributePatterns.join(", ")}`);
  }
  return match[1];
}

test("DB Service root renders a service-level Backup tab without close controls", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider runtime={runtime}>
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assert.match(html, /data-testid="layout\.service-tab-bar"/);
  assert.match(html, /data-qa-tab-type="backup"/);
  assert.match(
    html,
    /class="[^"]*\bbg-input\b[^"]*"[^>]*data-qa-object="service-tab"[^>]*data-qa-state="active"/
  );
  assert.match(
    html,
    /class="[^"]*\bbg-input\/30\b[^"]*"[^>]*data-qa-object="backup-method"/
  );
  assert.match(
    html,
    /class="[^"]*\bbg-input\/30\b[^"]*"[^>]*data-qa-object="backup-list-surface"/
  );
  assert.ok(html.includes("@container/backup-surface"));
  assert.ok(html.includes("@min-[60rem]/backup-surface:grid-cols-"));
  assert.ok(html.includes("@min-[48rem]/backup-surface:flex-row"));
  assert.match(html, /orders-manual-20260609/);
  assert.match(html, /orders-db/);
  assert.match(html, /data-testid="database\.backup\.create-button"/);
  assert.match(html, /data-qa-action="restore"/);
  assert.match(html, /data-qa-action="delete-backup"/);
  assertDefaultSecondaryButton(
    html,
    'data-testid="database\\.backup\\.create-button"'
  );
  assertDefaultSecondaryButton(
    html,
    'data-testid="database\\.backup\\.restore-button"'
  );
  assertDangerIconButton(
    html,
    'data-testid="database\\.backup\\.delete-button"'
  );
  assert.match(html, /data-qa-state="enabled"/);
  assert.doesNotMatch(html, /data-testid="layout\.tab\.close-button"/);
});

test("DB Service backup method toggle keeps inactive text stable and switch padding compact", () => {
  const manualHtml = renderToStaticMarkup(
    <DbAccessSessionProvider runtime={runtime}>
      <MainLayout />
    </DbAccessSessionProvider>
  );
  const policySegmentClass = elementClassName(
    manualHtml,
    "div",
    'data-slot="backup-method-policy-segment"'
  );

  assert.match(policySegmentClass, /\bpr-3\b/);
  assert.match(policySegmentClass, /\bpl-4\b/);
  assert.doesNotMatch(policySegmentClass, /hover:text-foreground/);

  const policyHtml = renderToStaticMarkup(
    <DbAccessSessionProvider
      runtime={{
        ...runtime,
        backupPolicy: {
          cronExpression: "0 2 * * *",
          enabled: true,
          retentionPeriod: "7d",
        },
      }}
    >
      <MainLayout />
    </DbAccessSessionProvider>
  );
  const manualButtonClass = elementClassName(
    policyHtml,
    "button",
    'data-qa-backup-method="manual"'
  );

  assert.match(manualButtonClass, /\btext-muted-foreground\b/);
  assert.doesNotMatch(manualButtonClass, /hover:text-foreground/);
});

test("DB Service backup policy actions use default secondary AppButton styling", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider
      runtime={{
        ...runtime,
        backupPolicy: {
          cronExpression: "0 2 * * *",
          enabled: true,
          retentionPeriod: "7d",
        },
      }}
    >
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assertDefaultSecondaryButton(
    html,
    'data-qa-action="reset"',
    'data-qa-object="backup-policy"'
  );
  assertDefaultSecondaryButton(
    html,
    'data-qa-action="save"',
    'data-qa-object="backup-policy"'
  );
  assert.ok(html.includes("@min-[40rem]/backup-surface:grid-cols-2"));
});

test("restore action is disabled for incomplete DB Service Backups", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider
      runtime={{
        ...runtime,
        backups: [
          {
            metadata: {
              creationTimestamp: "2026-06-09T05:00:00Z",
              name: "orders-manual-running",
              namespace: "database-system",
            },
            status: {
              phase: "Running",
              startTimestamp: "2026-06-09T05:00:00Z",
            },
          },
        ],
      }}
    >
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assert.match(html, /data-qa-action="restore"/);
  assert.match(html, /data-qa-state="disabled"/);
});

test("manual backup creation is disabled when DB Service is not Running", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider
      runtime={{
        ...runtime,
        dbServicePhase: "Creating",
      }}
    >
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assert.match(html, /data-qa-object="backup-create-form"/);
  assert.match(html, /data-qa-state="disabled"/);
  assert.match(html, /Current state: Creating/);
});

test("unsupported DB Service backup engines render unavailable state", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider
      runtime={{
        ...runtime,
        database: {
          displayEngine: "ClickHouse",
          name: "analytics",
        },
        engine: "UNSUPPORTED",
      }}
    >
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assert.match(html, /Backup unavailable/);
  assert.match(html, /ClickHouse/);
  assert.doesNotMatch(html, /Create backup/);
  assert.doesNotMatch(html, /Restore/);
});
