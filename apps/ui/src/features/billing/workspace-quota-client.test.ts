import { beforeEach, describe, expect, mock, test } from "bun:test";

let getWorkspaceQuota: () => Promise<unknown>;

mock.module("@labring/sealos-desktop-sdk/app", () => ({
  sealosApp: {
    getWorkspaceQuota: () => getWorkspaceQuota(),
  },
}));

const { loadWorkspaceQuotaSnapshot } = await import("./workspace-quota-client");

describe("loadWorkspaceQuotaSnapshot", () => {
  beforeEach(() => {
    getWorkspaceQuota = () =>
      Promise.resolve({
        quota: [
          { limit: 36_000, type: "cpu", used: 19_200 },
          { limit: 167_936, type: "memory", used: 26_880 },
          { limit: 204_800, type: "storage", used: 12_288 },
          { limit: 20, type: "pod", used: 3 },
          { limit: 10, type: "nodeport", used: 0 },
        ],
      });
  });

  test("loads the supported resource quota items", async () => {
    expect(await loadWorkspaceQuotaSnapshot()).toEqual({
      items: [
        { limit: 36_000, type: "cpu", used: 19_200 },
        { limit: 167_936, type: "memory", used: 26_880 },
        { limit: 204_800, type: "storage", used: 12_288 },
        { limit: 20, type: "pod", used: 3 },
        { limit: 10, type: "nodeport", used: 0 },
      ],
    });
  });

  test("filters GPU and traffic quota entries", async () => {
    getWorkspaceQuota = () =>
      Promise.resolve({
        quota: [
          { limit: 1, type: "gpu", used: 1 },
          { limit: 100, type: "traffic", used: 2 },
          { limit: 10, type: "pod", used: 3 },
        ],
      });

    expect(await loadWorkspaceQuotaSnapshot()).toEqual({
      items: [{ limit: 10, type: "pod", used: 3 }],
    });
  });

  test("fails open when the Desktop SDK is unavailable", async () => {
    getWorkspaceQuota = () => Promise.reject(new Error("sdk unavailable"));
    expect(await loadWorkspaceQuotaSnapshot()).toBeUndefined();
  });

  test("returns no snapshot when there are no supported items", async () => {
    getWorkspaceQuota = () => Promise.resolve({ quota: [] });
    expect(await loadWorkspaceQuotaSnapshot()).toBeUndefined();
  });
});
