import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatWorkspaceQuotaRows,
  type WorkspaceQuotaItem,
} from "./app-sidebar-upgrade";

test("formatWorkspaceQuotaRows maps Sealos quota items to sidebar rows", () => {
  const quota: WorkspaceQuotaItem[] = [
    { limit: 16_000, type: "cpu", used: 500 },
    { limit: 65_536, type: "memory", used: 1024 },
    { limit: 204_800, type: "storage", used: 3072 },
    { limit: 10, type: "nodeport", used: 0 },
  ];

  assert.deepEqual(formatWorkspaceQuotaRows(quota), [
    ["CPU", "0.5/16C"],
    ["Memory", "1Gi/64Gi"],
    ["Storage", "3Gi/200Gi"],
    ["Ports", "0/10"],
  ]);
});

test("formatWorkspaceQuotaRows keeps stable rows for missing quota items", () => {
  assert.deepEqual(
    formatWorkspaceQuotaRows([{ limit: 2000, type: "cpu", used: 1000 }]),
    [
      ["CPU", "1/2C"],
      ["Memory", "--/--"],
      ["Storage", "--/--"],
      ["Ports", "--/--"],
    ]
  );
});
