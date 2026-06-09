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
  databaseWorkloadName: "orders-db",
  databaseWorkloadNamespace: "database-system",
  dbServicePhase: "Running",
  engine: "POSTGRES",
  kubeconfig: "kube",
  namespace: "project-ns",
  projectId: "project-uid",
} satisfies DataBrowserHostContext;

test("DB Service root renders a service-level Backup tab without close controls", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider runtime={runtime}>
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assert.match(html, /data-testid="layout\.service-tab-bar"/);
  assert.match(html, /data-qa-tab-type="backup"/);
  assert.match(html, /data-testid="database\.backup\.create-form"/);
  assert.match(html, /Create backup/);
  assert.match(html, /orders-manual-20260609/);
  assert.match(html, /orders-db/);
  assert.doesNotMatch(html, /data-testid="layout\.tab\.close-button"/);
});

test("DB Service backup creation is disabled unless source service is running", () => {
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
