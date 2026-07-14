import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import { DataBrowserPane } from "./DataBrowserPane";

test("unsupported DB Service roots still render the service Backup unavailable surface", () => {
  const html = renderToStaticMarkup(
    <DataBrowserPane
      kubeconfig="kube"
      namespace="project-ns"
      projectId="project-uid"
      selectedDatabaseData={
        {
          connections: [],
          states: {
            displayEngine: "ClickHouse",
            engineKey: "clickhouse",
            name: "analytics",
          },
          workload: {
            name: "analytics-db",
            namespace: "database-system",
          },
        } satisfies CanvasDatabaseNodeData
      }
    />
  );

  assert.match(html, /data-testid="layout\.service-tab-bar"/);
  assert.match(html, /data-qa-resource-type="db_service"/);
  assert.match(html, /data-qa-state="selected collapsed"/);
  assert.match(html, /Backup unavailable/);
  assert.match(html, /ClickHouse/);
});
