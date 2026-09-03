import { describe, expect, test } from "bun:test";

import {
  formatWorkspaceQuotaRows,
  workspaceQuotaSnapshotFromPayload,
  workspaceResourceQuotaSnapshotSchema,
} from "./workspace-resource-quota";

describe("workspace resource quota", () => {
  test("parses and formats the supported resource items", () => {
    const items = workspaceResourceQuotaSnapshotSchema.parse({
      items: [
        { limit: 36_000, type: "cpu", used: 19_200 },
        { limit: 167_936, type: "memory", used: 26_880 },
        { limit: 204_800, type: "storage", used: 12_288 },
        { limit: 20, type: "pod", used: 3 },
        { limit: 10, type: "nodeport", used: 0 },
      ],
    }).items;

    expect(formatWorkspaceQuotaRows(items)).toEqual([
      ["CPU", "19.2C/36C"],
      ["Memory", "26.25Gi/164Gi"],
      ["Storage", "12Gi/200Gi"],
      ["Pods", "3/20"],
      ["Ports", "0/10"],
    ]);
  });

  test("filters malformed and unsupported items", () => {
    expect(
      workspaceResourceQuotaSnapshotSchema.safeParse({
        items: [
          { limit: 4, type: "cpu", used: Number.NaN },
          { limit: 4096, type: "memory", used: 2048 },
          { limit: -1, type: "pod", used: 0 },
        ],
      }).success
    ).toBe(false);

    expect(
      formatWorkspaceQuotaRows([{ limit: 4096, type: "memory", used: 2048 }], {
        includeMissing: false,
      })
    ).toEqual([["Memory", "2Gi/4Gi"]]);
  });

  test("fills missing rows for the sidebar but not for the agent", () => {
    const items = [{ limit: 2000, type: "cpu", used: 1000 } as const];

    expect(formatWorkspaceQuotaRows(items)).toEqual([
      ["CPU", "1C/2C"],
      ["Memory", "--/--"],
      ["Storage", "--/--"],
      ["Pods", "--/--"],
      ["Ports", "--/--"],
    ]);
    expect(formatWorkspaceQuotaRows(items, { includeMissing: false })).toEqual([
      ["CPU", "1C/2C"],
    ]);
  });

  test("normalizes account-service quantities into snapshot units", () => {
    expect(
      workspaceQuotaSnapshotFromPayload({
        quota: {
          hard: {
            "limits.cpu": "36",
            "limits.memory": "164Gi",
            pods: "20",
            "requests.storage": "200Gi",
            "services.nodeports": 10,
          },
          used: {
            "limits.cpu": "19200m",
            "limits.memory": "26880Mi",
            pods: 3,
            "requests.storage": "12Gi",
            "services.nodeports": "0",
          },
        },
      })
    ).toEqual({
      items: [
        { exhausted: false, limit: 36_000, type: "cpu", used: 19_200 },
        { exhausted: false, limit: 167_936, type: "memory", used: 26_880 },
        { exhausted: false, limit: 204_800, type: "storage", used: 12_288 },
        { exhausted: false, limit: 20, type: "pod", used: 3 },
        { exhausted: false, limit: 10, type: "nodeport", used: 0 },
      ],
    });
  });

  test("pairs quota aliases from the same account-service resource key", () => {
    expect(
      workspaceQuotaSnapshotFromPayload({
        quota: {
          hard: { "count/pods": "40", pods: "20" },
          used: { "count/pods": "30" },
        },
      })
    ).toEqual({
      items: [{ exhausted: false, limit: 40, type: "pod", used: 30 }],
    });
  });

  test("ignores GPU and traffic fields from the account-service payload", () => {
    expect(
      workspaceQuotaSnapshotFromPayload({
        quota: {
          hard: {
            "limits.nvidia.com/gpu": "1",
            pods: "10",
            traffic: "100Gi",
          },
          used: {
            "limits.nvidia.com/gpu": "1",
            pods: "3",
            traffic: "2Gi",
          },
        },
      })
    ).toEqual({
      items: [{ exhausted: false, limit: 10, type: "pod", used: 3 }],
    });
  });

  test("fails open for malformed account-service payloads and quantities", () => {
    expect(workspaceQuotaSnapshotFromPayload(null)).toBeUndefined();
    expect(
      workspaceQuotaSnapshotFromPayload({ quota: { hard: [], used: {} } })
    ).toBeUndefined();
    expect(
      workspaceQuotaSnapshotFromPayload({
        quota: {
          hard: { "limits.cpu": "not-a-quantity" },
          used: { "limits.cpu": "1" },
        },
      })
    ).toBeUndefined();
  });
});
