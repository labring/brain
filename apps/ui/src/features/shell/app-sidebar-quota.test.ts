import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatWorkspaceQuotaRows,
  quotaUsageTone,
  type WorkspaceQuotaItem,
} from "./app-sidebar-quota";

test("formatWorkspaceQuotaRows maps Sealos quota items to sidebar rows", () => {
  const quota: WorkspaceQuotaItem[] = [
    { limit: 16_000, type: "cpu", used: 500 },
    { limit: 65_536, type: "memory", used: 1024 },
    { limit: 204_800, type: "storage", used: 3072 },
    { limit: 20, type: "pod", used: 3 },
    { limit: 10, type: "nodeport", used: 0 },
  ];

  assert.deepEqual(formatWorkspaceQuotaRows(quota), [
    { label: "CPU", percent: 3.125, value: "0.5C/16C" },
    { label: "Memory", percent: 1.5625, value: "1Gi/64Gi" },
    { label: "Storage", percent: 1.5, value: "3Gi/200Gi" },
    { label: "Pods", percent: 15, value: "3/20" },
    { label: "Ports", percent: 0, value: "0/10" },
  ]);
});

test("formatWorkspaceQuotaRows keeps stable rows for missing quota items", () => {
  assert.deepEqual(
    formatWorkspaceQuotaRows([{ limit: 2000, type: "cpu", used: 1000 }]),
    [
      { label: "CPU", percent: 50, value: "1C/2C" },
      { label: "Memory", percent: null, value: "--/--" },
      { label: "Storage", percent: null, value: "--/--" },
      { label: "Pods", percent: null, value: "--/--" },
      { label: "Ports", percent: null, value: "--/--" },
    ]
  );
});

test("formatWorkspaceQuotaRows clamps overconsumption to 100 percent", () => {
  const rows = formatWorkspaceQuotaRows([{ limit: 10, type: "pod", used: 14 }]);
  assert.equal(rows[3]?.percent, 100);
});

test("quotaUsageTone steps from quiet to warn to danger", () => {
  assert.equal(quotaUsageTone(null), null);
  assert.equal(quotaUsageTone(0), null);
  assert.equal(quotaUsageTone(79.9), null);
  assert.equal(quotaUsageTone(80), "warn");
  assert.equal(quotaUsageTone(99.9), "warn");
  assert.equal(quotaUsageTone(100), "danger");
});

test("formatWorkspaceQuotaRows yields no percent for a zero or invalid limit", () => {
  const rows = formatWorkspaceQuotaRows([
    { limit: 0, type: "pod", used: 3 },
    { limit: Number.NaN, type: "nodeport", used: 1 },
  ]);
  assert.equal(rows[3]?.percent, null);
  assert.equal(rows[4]?.percent, null);
});
