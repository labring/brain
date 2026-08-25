import { beforeEach, describe, expect, mock, test } from "bun:test";

let getWorkspaceQuota: () => Promise<unknown>;
let sdkCalls = 0;

mock.module("@labring/sealos-desktop-sdk/app", () => ({
  sealosApp: {
    getWorkspaceQuota: () => {
      sdkCalls += 1;
      return getWorkspaceQuota();
    },
  },
}));

const { loadWorkspaceQuotaSnapshot, readCachedWorkspaceQuotaSnapshot } =
  await import("./workspace-quota-client");

describe("loadWorkspaceQuotaSnapshot", () => {
  beforeEach(() => {
    sdkCalls = 0;
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
    expect(await loadWorkspaceQuotaSnapshot("workspace-loaded")).toEqual({
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

    expect(await loadWorkspaceQuotaSnapshot("workspace-filtered")).toEqual({
      items: [{ limit: 10, type: "pod", used: 3 }],
    });
  });

  test("fails open when the Desktop SDK is unavailable", async () => {
    getWorkspaceQuota = () => Promise.reject(new Error("sdk unavailable"));
    expect(
      await loadWorkspaceQuotaSnapshot("workspace-unavailable")
    ).toBeUndefined();
  });

  test("returns no snapshot when there are no supported items", async () => {
    getWorkspaceQuota = () => Promise.resolve({ quota: [] });
    expect(await loadWorkspaceQuotaSnapshot("workspace-empty")).toBeUndefined();
  });

  test("reuses a cached snapshot for the same namespace", async () => {
    const namespace = "workspace-cache";

    await loadWorkspaceQuotaSnapshot(namespace);
    getWorkspaceQuota = () => Promise.reject(new Error("should not reload"));

    expect(await loadWorkspaceQuotaSnapshot(namespace)).toEqual({
      items: [
        { limit: 36_000, type: "cpu", used: 19_200 },
        { limit: 167_936, type: "memory", used: 26_880 },
        { limit: 204_800, type: "storage", used: 12_288 },
        { limit: 20, type: "pod", used: 3 },
        { limit: 10, type: "nodeport", used: 0 },
      ],
    });
  });

  test("deduplicates concurrent requests per namespace", async () => {
    const namespace = "workspace-in-flight";
    let resolveQuota!: (value: unknown) => void;
    getWorkspaceQuota = () =>
      new Promise((resolve) => {
        resolveQuota = resolve;
      });

    const first = loadWorkspaceQuotaSnapshot(namespace);
    const second = loadWorkspaceQuotaSnapshot(namespace);
    expect(sdkCalls).toBe(1);
    resolveQuota({ quota: [{ limit: 10, type: "pod", used: 3 }] });

    await expect(first).resolves.toEqual({
      items: [{ limit: 10, type: "pod", used: 3 }],
    });
    await expect(second).resolves.toEqual({
      items: [{ limit: 10, type: "pod", used: 3 }],
    });
  });

  test("isolates cached snapshots by namespace", async () => {
    await loadWorkspaceQuotaSnapshot("workspace-one");
    getWorkspaceQuota = () =>
      Promise.resolve({ quota: [{ limit: 8, type: "pod", used: 2 }] });
    await loadWorkspaceQuotaSnapshot("workspace-two");

    expect(readCachedWorkspaceQuotaSnapshot("workspace-one")).toEqual({
      items: [
        { limit: 36_000, type: "cpu", used: 19_200 },
        { limit: 167_936, type: "memory", used: 26_880 },
        { limit: 204_800, type: "storage", used: 12_288 },
        { limit: 20, type: "pod", used: 3 },
        { limit: 10, type: "nodeport", used: 0 },
      ],
    });
    expect(readCachedWorkspaceQuotaSnapshot("workspace-two")).toEqual({
      items: [{ limit: 8, type: "pod", used: 2 }],
    });
  });

  test("reads the cache synchronously without calling the SDK", async () => {
    const namespace = "workspace-sync-read";
    expect(readCachedWorkspaceQuotaSnapshot(namespace)).toBeUndefined();
    await loadWorkspaceQuotaSnapshot(namespace);
    getWorkspaceQuota = () => Promise.reject(new Error("should not load"));

    expect(readCachedWorkspaceQuotaSnapshot(namespace)).toEqual({
      items: [
        { limit: 36_000, type: "cpu", used: 19_200 },
        { limit: 167_936, type: "memory", used: 26_880 },
        { limit: 204_800, type: "storage", used: 12_288 },
        { limit: 20, type: "pod", used: 3 },
        { limit: 10, type: "nodeport", used: 0 },
      ],
    });
    expect(sdkCalls).toBe(1);
  });
});
