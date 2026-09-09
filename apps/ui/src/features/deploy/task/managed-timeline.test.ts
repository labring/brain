import { describe, expect, it } from "bun:test";

import {
  attachManagedDeploymentTimelineSuccess,
  managedDeploymentTimelineResultCards,
} from "./managed-timeline";
import type { DeploymentTaskTimelineSnapshot } from "./timeline";

const resources = [
  {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "web",
    namespace: "ns-demo",
  },
  {
    apiVersion: "v1",
    kind: "Service",
    name: "web",
    namespace: "ns-demo",
  },
  {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    name: "web",
    namespace: "ns-demo",
  },
];

function timeline(): DeploymentTaskTimelineSnapshot {
  return {
    revision: 1,
    status: "applying",
    steps: [
      {
        events: [],
        id: "create-resources",
        label: "Create resources",
        order: 0,
        status: "running",
      },
    ],
    taskId: "task-managed",
    updatedAt: "2026-09-04T10:00:00.000Z",
  };
}

describe("managed deployment Timeline evidence", () => {
  it("keeps runtime and endpoint evidence but excludes supporting objects", () => {
    const cards = managedDeploymentTimelineResultCards({
      accessEndpoints: [
        {
          id: "public-web",
          label: "Web address",
          url: "https://web.ns-demo.sealos.run",
        },
      ],
      namespace: "ns-demo",
      resources,
    });

    expect(cards.map((card) => card.resultRef.kind)).toEqual([
      "KubernetesWorkload",
      "AccessEndpoint",
    ]);
    expect(
      cards.every((card) => card.required && card.status === "running")
    ).toBe(true);
  });

  it("derives the success count and entries from the visible required cards", () => {
    const next = attachManagedDeploymentTimelineSuccess(timeline(), {
      accessEndpoints: [
        {
          id: "public-web",
          label: "Web address",
          url: "https://web.ns-demo.sealos.run",
        },
      ],
      namespace: "ns-demo",
      productName: "GitHub app",
      resources,
      updatedAt: "2026-09-04T10:00:01.000Z",
    });

    expect(next.steps[0]?.resultCards).toHaveLength(2);
    expect(next.success?.verification).toEqual({ passed: 2, total: 2 });
    expect(next.success?.entries).toEqual([
      {
        label: "Web address",
        protocol: "https",
        url: "https://web.ns-demo.sealos.run",
      },
    ]);
  });
});
