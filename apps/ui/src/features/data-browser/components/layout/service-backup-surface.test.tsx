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
        annotations: {
          "brain.io/description": "Before invoice migration",
        },
        creationTimestamp: "2026-06-09T05:00:00Z",
        name: "orders-manual-20260609",
        namespace: "database-system",
      },
      status: {
        completionTimestamp: "2026-06-09T05:03:00Z",
        phase: "Completed",
        startTimestamp: "2026-06-09T05:00:00Z",
        totalSize: "10Gi",
      },
    },
    {
      metadata: {
        creationTimestamp: "2026-06-08T05:00:00Z",
        labels: {
          "dataprotection.kubeblocks.io/backup-policy": "daily",
        },
        name: "orders-auto-20260608",
        namespace: "database-system",
      },
      status: {
        failureReason: "volume snapshot failed",
        phase: "Failed",
        startTimestamp: "2026-06-08T05:00:00Z",
      },
    },
    {
      metadata: {
        creationTimestamp: "2026-06-10T05:00:00Z",
        name: "orders-running-20260610",
        namespace: "database-system",
      },
      status: {
        phase: "Running",
        startTimestamp: "2026-06-10T05:00:00Z",
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

function assertStatusBadgeClass(
  html: string,
  state: string,
  backgroundClassName: string
) {
  const className = elementClassName(
    html,
    "span",
    'data-qa-object="backup-status-badge"',
    `data-qa-state="${state}"`
  );
  const classes = className.split(/\s+/);
  assert.ok(classes.includes(backgroundClassName));
  assert.ok(classes.includes("font-normal"));
  assert.ok(classes.includes("px-2.5"));
  assert.ok(classes.includes("shrink-0"));
  assert.ok(classes.includes("text-brand-primary-foreground"));
  assert.ok(classes.includes("text-xs"));
  assert.ok(
    !classes.some((name) => name === "border" || name.startsWith("border-"))
  );
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
  const backupRowClassName = elementClassName(
    html,
    "article",
    'data-testid="database\\.backup\\.row"',
    'data-qa-resource-id="orders-manual-20260609"'
  );
  const backupRowClasses = backupRowClassName.split(/\s+/);
  assert.ok(backupRowClasses.includes("flex-row"));
  assert.ok(backupRowClasses.includes("items-center"));
  assert.ok(backupRowClasses.includes("justify-between"));
  assert.ok(!backupRowClasses.includes("flex-col"));
  const backupRowActionsClassName = elementClassName(
    html,
    "div",
    'data-qa-object="backup-row-actions"',
    'data-qa-resource-id="orders-manual-20260609"'
  );
  const backupRowActionsClasses = backupRowActionsClassName.split(/\s+/);
  assert.ok(backupRowActionsClasses.includes("shrink-0"));
  assert.ok(!backupRowActionsClasses.includes("flex-wrap"));
  assert.match(html, /orders-manual-20260609/);
  assert.match(html, /Before invoice migration/);
  assert.match(html, /data-qa-object="backup-row-name"/);
  assert.match(html, /data-qa-object="backup-row-description"/);
  assert.match(html, /data-qa-object="backup-row-time"/);
  assert.match(html, /data-qa-object="backup-row-type"/);
  assert.match(html, />Manual</);
  assert.match(html, />Automatic</);
  assert.match(html, />Completed</);
  assert.match(html, />Failed</);
  assert.match(html, />Backing up</);
  assert.doesNotMatch(html, />Running</);
  assertStatusBadgeClass(html, "completed", "bg-emerald-500/30");
  assertStatusBadgeClass(html, "failed", "bg-destructive/30");
  assertStatusBadgeClass(html, "running", "bg-blue-500/30");
  assert.match(html, /data-qa-object="backup-status-tooltip-trigger"/);
  assert.match(html, /data-qa-state="failed"/);
  assert.doesNotMatch(html, /bg-zinc-950/);
  assert.doesNotMatch(html, /text-zinc-100/);
  assert.doesNotMatch(html, /database\.backup\.create-accepted/);
  assert.doesNotMatch(html, /database\.backup\.create-error/);
  assert.doesNotMatch(html, /database\.backup\.delete-error/);
  assert.doesNotMatch(html, /database\.backup\.refresh-error/);
  assert.doesNotMatch(html, /database\.backup\.restore-feedback/);
  assert.match(html, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.doesNotMatch(html, /10Gi/);
  assert.doesNotMatch(html, /3m/);
  assert.doesNotMatch(html, /orders-db \/ orders-manual-20260609/);
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

test("DB Service backup empty state is unframed", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider
      runtime={{
        ...runtime,
        backups: [],
      }}
    >
      <MainLayout />
    </DbAccessSessionProvider>
  );
  const emptyClassName = elementClassName(
    html,
    "div",
    'data-testid="database\\.backup\\.empty"'
  );
  const classes = emptyClassName.split(/\s+/);

  assert.ok(
    !classes.some((name) => name === "border" || name.startsWith("border-"))
  );
  assert.ok(!classes.some((name) => name.startsWith("bg-")));
  assert.match(html, /No backups found/);
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
