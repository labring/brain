import assert from "node:assert/strict";
import { test } from "node:test";

import { loadBillingUsage } from "./billing-usage-data";

const NOW = new Date("2026-07-30T12:00:00.000Z");

test("loads current workspace quota with ordered headroom rows", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const responses: Record<string, unknown> = {
    "/api/billing/workspace-quota": {
      quota: {
        hard: {
          ai_quota: 20_000_000,
          "limits.cpu": "4",
          "limits.memory": "8Gi",
          "limits.nvidia.com/gpu": "2",
          "requests.storage": "100Gi",
          "services.nodeports": "10",
          traffic: "100Gi",
        },
        used: {
          ai_quota: 12_000_000,
          "limits.cpu": "1500m",
          "limits.memory": "3Gi",
          "limits.nvidia.com/gpu": "1",
          "requests.storage": "40Gi",
          "services.nodeports": "3",
          traffic: "25Gi",
        },
      },
    },
    "/api/billing/workspaces": {
      data: [
        ["workspace-a", "Workspace Alpha"],
        ["workspace-b", "Workspace Beta"],
      ],
    },
  };

  const snapshot = await loadBillingUsage(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-b",
    },
    {
      fetch: (input, init) => {
        const url = new URL(input.toString(), "https://brain.example.test");
        requests.push({
          body: init?.body == null ? null : JSON.parse(init.body.toString()),
          headers: new Headers(init?.headers),
          url: url.pathname,
        });
        const response = responses[url.pathname];
        assert.notEqual(
          response,
          undefined,
          `fixture exists for ${url.pathname}`
        );
        return Promise.resolve(Response.json(response));
      },
      now: () => NOW,
    }
  );

  assert.equal(snapshot.selectedWorkspace, "workspace-b");
  assert.deepEqual(snapshot.workspaces, [
    { id: "workspace-a", name: "Workspace Alpha" },
    { id: "workspace-b", name: "Workspace Beta" },
  ]);
  assert.deepEqual(snapshot.rows, [
    {
      label: "CPU",
      percentUsed: 37.5,
      remaining: "2.5",
      total: "4",
      type: "cpu",
      used: "1.5",
    },
    {
      label: "Memory",
      percentUsed: 37.5,
      remaining: "5Gi",
      total: "8Gi",
      type: "memory",
      used: "3Gi",
    },
    {
      label: "Storage",
      percentUsed: 40,
      remaining: "60Gi",
      total: "100Gi",
      type: "storage",
      used: "40Gi",
    },
    {
      label: "Ports",
      percentUsed: 30,
      remaining: "7",
      total: "10",
      type: "nodeport",
      used: "3",
    },
    {
      label: "Traffic",
      percentUsed: 25,
      remaining: "75Gi",
      total: "100Gi",
      type: "traffic",
      used: "25Gi",
    },
    {
      label: "GPU",
      percentUsed: 50,
      remaining: "1",
      total: "2",
      type: "gpu",
      used: "1",
    },
  ]);

  const quotaRequest = requests.find(
    (request) => request.url === "/api/billing/workspace-quota"
  );
  assert.deepEqual(quotaRequest?.body, {
    workspace: "workspace-b",
  });
  const workspaceRequest = requests.find(
    (request) => request.url === "/api/billing/workspaces"
  );
  assert.deepEqual(workspaceRequest?.body, {
    endTime: "2026-07-30T12:00:00.000Z",
    startTime: "2026-06-29T12:00:00.000Z",
    type: 0,
  });
  for (const request of requests) {
    assert.equal(
      request.headers.get("X-Sealos-App-Token"),
      "desktop-app-token"
    );
    assert.equal(
      request.headers.get("Authorization"),
      "Bearer apiVersion%3A%20v1"
    );
  }
});

test("falls back to the first available workspace", async () => {
  const snapshot = await loadBillingUsage(
    {
      appToken: "token",
      kubeconfig: "kubeconfig",
      workspace: "missing-workspace",
    },
    {
      fetch: (input) => {
        const pathname = new URL(input.toString(), "https://brain.example.test")
          .pathname;
        if (pathname === "/api/billing/workspaces") {
          return Promise.resolve(
            Response.json({ data: [["workspace-a", ""]] })
          );
        }
        return Promise.resolve(
          Response.json({ quota: { hard: {}, used: {} } })
        );
      },
      now: () => NOW,
    }
  );

  assert.equal(snapshot.selectedWorkspace, "workspace-a");
  assert.deepEqual(snapshot.workspaces, [
    { id: "workspace-a", name: "workspace-a" },
  ]);
  assert.deepEqual(snapshot.rows, []);
});
