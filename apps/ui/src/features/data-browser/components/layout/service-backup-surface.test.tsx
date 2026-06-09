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

test("DB Service root renders a service-level Backup tab without close controls", () => {
  const html = renderToStaticMarkup(
    <DbAccessSessionProvider runtime={runtime}>
      <MainLayout />
    </DbAccessSessionProvider>
  );

  assert.match(html, /data-testid="layout\.service-tab-bar"/);
  assert.match(html, /data-qa-tab-type="backup"/);
  assert.match(html, /orders-manual-20260609/);
  assert.match(html, /orders-db/);
  assert.match(html, /Create backup/);
  assert.match(html, /data-qa-action="restore"/);
  assert.match(html, /data-qa-action="delete-backup"/);
  assert.match(html, /data-qa-state="enabled"/);
  assert.doesNotMatch(html, /data-testid="layout\.tab\.close-button"/);
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
