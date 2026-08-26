import { describe, expect, test } from "bun:test";

import {
  formatWorkspaceQuotaRows,
  parseWorkspaceQuotaItems,
} from "./workspace-resource-quota";

describe("workspace resource quota", () => {
  test("parses and formats the supported resource items", () => {
    const items = parseWorkspaceQuotaItems([
      { limit: 36_000, type: "cpu", used: 19_200 },
      { limit: 167_936, type: "memory", used: 26_880 },
      { limit: 204_800, type: "storage", used: 12_288 },
      { limit: 20, type: "pod", used: 3 },
      { limit: 10, type: "nodeport", used: 0 },
      { limit: 1, type: "gpu", used: 1 },
    ]);

    expect(formatWorkspaceQuotaRows(items)).toEqual([
      ["CPU", "19.2C/36C"],
      ["Memory", "26.25Gi/164Gi"],
      ["Storage", "12Gi/200Gi"],
      ["Pods", "3/20"],
      ["Ports", "0/10"],
    ]);
  });

  test("filters malformed and unsupported items", () => {
    const items = parseWorkspaceQuotaItems([
      { limit: 4, type: "cpu", used: Number.NaN },
      { limit: 4, type: "gpu", used: 1 },
      { limit: 4096, type: "memory", used: 2048 },
      { limit: -1, type: "pod", used: 0 },
    ]);

    expect(items).toEqual([{ limit: 4096, type: "memory", used: 2048 }]);
    expect(formatWorkspaceQuotaRows(items, { includeMissing: false })).toEqual([
      ["Memory", "2Gi/4Gi"],
    ]);
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
});
