import { describe, expect, test } from "bun:test";

import type { BillingFetch } from "./billing-data-client";
import {
  loadWorkspaceQuotaSnapshot,
  readCachedWorkspaceQuotaSnapshot,
  type WorkspaceQuotaLoadInput,
} from "./workspace-quota-client";
import type { WorkspaceResourceQuotaSnapshot } from "./workspace-resource-quota";

const QUOTA_PAYLOAD = {
  quota: {
    hard: {
      "limits.cpu": "36",
      "limits.memory": "164Gi",
      pods: "20",
      "requests.storage": "200Gi",
      "services.nodeports": "10",
    },
    used: {
      "limits.cpu": "19200m",
      "limits.memory": "26880Mi",
      pods: "3",
      "requests.storage": "12Gi",
      "services.nodeports": "0",
    },
  },
};

const EXPECTED_SNAPSHOT: WorkspaceResourceQuotaSnapshot = {
  items: [
    { limit: 36_000, type: "cpu", used: 19_200 },
    { limit: 167_936, type: "memory", used: 26_880 },
    { limit: 204_800, type: "storage", used: 12_288 },
    { limit: 20, type: "pod", used: 3 },
    { limit: 10, type: "nodeport", used: 0 },
  ],
};

function input(namespace: string): WorkspaceQuotaLoadInput {
  return {
    appToken: "desktop-app-token",
    kubeconfig: "apiVersion: v1",
    namespace,
  };
}

function jsonFetch(
  payload: unknown,
  requests: Array<{ init?: RequestInit; url: string }> = []
): BillingFetch {
  return (request, init) => {
    requests.push({ init, url: request.toString() });
    return Promise.resolve(Response.json(payload));
  };
}

describe("loadWorkspaceQuotaSnapshot", () => {
  test("loads normalized quota through the Brain API", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];

    expect(
      await loadWorkspaceQuotaSnapshot(
        input("workspace-loaded"),
        jsonFetch(QUOTA_PAYLOAD, requests)
      )
    ).toEqual(EXPECTED_SNAPSHOT);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/billing/workspace-quota");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.cache).toBe("no-store");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      workspace: "workspace-loaded",
    });
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer apiVersion%3A%20v1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Sealos-App-Token")).toBe("desktop-app-token");
  });

  test("fails open when the Brain API is unavailable", async () => {
    const fetch: BillingFetch = () => Promise.reject(new Error("api down"));

    expect(
      await loadWorkspaceQuotaSnapshot(input("workspace-unavailable"), fetch)
    ).toBeUndefined();
  });

  test("returns no snapshot when there are no supported items", async () => {
    expect(
      await loadWorkspaceQuotaSnapshot(
        input("workspace-empty"),
        jsonFetch({ quota: { hard: {}, used: {} } })
      )
    ).toBeUndefined();
  });

  test("does not request quota without complete credentials", async () => {
    let calls = 0;
    const fetch: BillingFetch = () => {
      calls += 1;
      return Promise.resolve(Response.json(QUOTA_PAYLOAD));
    };

    expect(
      await loadWorkspaceQuotaSnapshot(
        { ...input("workspace-no-token"), appToken: "" },
        fetch
      )
    ).toBeUndefined();
    expect(
      await loadWorkspaceQuotaSnapshot(
        { ...input("workspace-no-kubeconfig"), kubeconfig: "" },
        fetch
      )
    ).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("reuses a cached snapshot for the same namespace", async () => {
    const credentials = input("workspace-cache");
    let calls = 0;
    const fetch: BillingFetch = () => {
      calls += 1;
      return Promise.resolve(Response.json(QUOTA_PAYLOAD));
    };

    await loadWorkspaceQuotaSnapshot(credentials, fetch);
    expect(await loadWorkspaceQuotaSnapshot(credentials, fetch)).toEqual(
      EXPECTED_SNAPSHOT
    );
    expect(calls).toBe(1);
  });

  test("returns the previous snapshot when a stale refresh fails", async () => {
    const credentials = input("workspace-stale");
    const originalDateNow = Date.now;
    let now = 1000;
    let calls = 0;
    Date.now = () => now;

    try {
      const fetch: BillingFetch = () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(Response.json(QUOTA_PAYLOAD))
          : Promise.reject(new Error("api down"));
      };

      await loadWorkspaceQuotaSnapshot(credentials, fetch);
      now += 30_000;

      expect(await loadWorkspaceQuotaSnapshot(credentials, fetch)).toEqual(
        EXPECTED_SNAPSHOT
      );
      expect(calls).toBe(2);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("deduplicates concurrent requests per namespace", async () => {
    const credentials = input("workspace-in-flight");
    let calls = 0;
    let resolveQuota!: (response: Response) => void;
    const fetch: BillingFetch = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveQuota = resolve;
      });
    };

    const first = loadWorkspaceQuotaSnapshot(credentials, fetch);
    const second = loadWorkspaceQuotaSnapshot(credentials, fetch);
    expect(calls).toBe(1);
    resolveQuota(Response.json(QUOTA_PAYLOAD));

    await expect(first).resolves.toEqual(EXPECTED_SNAPSHOT);
    await expect(second).resolves.toEqual(EXPECTED_SNAPSHOT);
  });

  test("isolates cached snapshots by namespace", async () => {
    const firstInput = input("workspace-one");
    const secondInput = input("workspace-two");

    await loadWorkspaceQuotaSnapshot(firstInput, jsonFetch(QUOTA_PAYLOAD));
    await loadWorkspaceQuotaSnapshot(
      secondInput,
      jsonFetch({
        quota: { hard: { pods: "8" }, used: { pods: "2" } },
      })
    );

    expect(readCachedWorkspaceQuotaSnapshot(firstInput)).toEqual(
      EXPECTED_SNAPSHOT
    );
    expect(readCachedWorkspaceQuotaSnapshot(secondInput)).toEqual({
      items: [{ limit: 8, type: "pod", used: 2 }],
    });
  });

  test("reads the cache synchronously without another API request", async () => {
    const credentials = input("workspace-sync-read");
    let calls = 0;
    const fetch: BillingFetch = () => {
      calls += 1;
      return Promise.resolve(Response.json(QUOTA_PAYLOAD));
    };

    expect(
      readCachedWorkspaceQuotaSnapshot(credentials, fetch)
    ).toBeUndefined();
    await loadWorkspaceQuotaSnapshot(credentials, fetch);

    expect(readCachedWorkspaceQuotaSnapshot(credentials, fetch)).toEqual(
      EXPECTED_SNAPSHOT
    );
    expect(calls).toBe(1);
  });
});
