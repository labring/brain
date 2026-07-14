import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPendingSettingsStatusModel } from "./pending-settings-status";
import type { PendingSettingsClassification } from "./pending-settings-updates";

function classification(
  domain: string,
  status: PendingSettingsClassification["status"],
  kind: "ap" | "database" = "ap"
): PendingSettingsClassification {
  return {
    entry: {
      clusterFingerprint: "sha256:cluster",
      domain,
      kind,
      name: "resource",
      namespace: "demo",
      submittedAgainst: {},
      submittedAtMs: 1000,
      target: {},
      version: 1,
    },
    status,
  };
}

test("pending settings status model renders approved copy and domain labels", () => {
  const model = buildPendingSettingsStatusModel([
    classification("network", "applying"),
    classification("resources", "attention-needed", "database"),
    classification("environment", "diverged"),
    classification("launch", "reconciled"),
  ]);

  assert.deepEqual(
    model.rows.map((row) => ({
      actions: row.actions,
      body: row.body,
      label: row.label,
      title: row.title,
    })),
    [
      {
        actions: [],
        body: "Your update was accepted. This page shows the target configuration while the resource catches up.",
        label: "Network",
        title: "Applying changes",
      },
      {
        actions: ["edit", "use-latest"],
        body: "This is taking longer than expected. You can keep editing from the target configuration or use the latest observed configuration.",
        label: "Resources",
        title: "Still applying changes",
      },
      {
        actions: ["keep-target", "use-latest"],
        body: "The resource configuration changed after your update was accepted.",
        label: "Environment",
        title: "Configuration changed elsewhere",
      },
    ]
  );
});
