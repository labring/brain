import { describe, expect, test } from "bun:test";

import {
  parseWorkspaceResourceQuotaPayload,
  unavailableWorkspaceResourceQuota,
} from "./workspace-resource-quota";

describe("workspace resource quota", () => {
  test("formats the model context rows as used over limit", () => {
    expect(
      parseWorkspaceResourceQuotaPayload({
        quota: {
          hard: {
            ai_quota: 20_000_000,
            "limits.cpu": "36",
            "limits.memory": "164Gi",
            "requests.storage": "200Gi",
            "services.nodeports": "10",
          },
          used: {
            ai_quota: 5_000_000,
            "limits.cpu": "19200m",
            "limits.memory": "26880Mi",
            "requests.storage": "12Gi",
            "services.nodeports": 0,
          },
        },
      })
    ).toEqual({
      rows: [
        ["CPU", "19.2C/36C"],
        ["Memory", "26.25Gi/164Gi"],
        ["Storage", "12Gi/200Gi"],
        ["Pods", "--/--"],
        ["Ports", "0/10"],
      ],
      status: "available",
    });
  });

  test("does not expose AI quota and replaces incomplete values with placeholders", () => {
    expect(
      parseWorkspaceResourceQuotaPayload({
        quota: {
          hard: { ai_quota: 20_000_000, "limits.cpu": "4" },
          used: { ai_quota: 5_000_000, "limits.cpu": "invalid" },
        },
      }).rows
    ).toEqual([
      ["CPU", "--/--"],
      ["Memory", "--/--"],
      ["Storage", "--/--"],
      ["Pods", "--/--"],
      ["Ports", "--/--"],
    ]);
  });

  test("creates a stable unavailable snapshot", () => {
    expect(unavailableWorkspaceResourceQuota()).toEqual({
      rows: [
        ["CPU", "--/--"],
        ["Memory", "--/--"],
        ["Storage", "--/--"],
        ["Pods", "--/--"],
        ["Ports", "--/--"],
      ],
      status: "unavailable",
    });
  });
});
