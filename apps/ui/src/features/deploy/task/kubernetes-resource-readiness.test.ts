import { describe, expect, it } from "bun:test";

import {
  isKubernetesResourceReady,
  isKubernetesRuntimeResourceKind,
} from "./kubernetes-resource-readiness";

describe("shared Kubernetes deployment readiness", () => {
  it("accepts a Deployment from Ready replicas without waiting for Available replicas", () => {
    expect(
      isKubernetesResourceReady("Deployment", {
        generation: 2,
        spec: { replicas: 2 },
        status: {
          availableReplicas: 0,
          observedGeneration: 2,
          readyReplicas: 2,
        },
      })
    ).toBe(true);
  });

  it("rejects stale controller observations", () => {
    expect(
      isKubernetesResourceReady("StatefulSet", {
        generation: 2,
        spec: { replicas: 1 },
        status: { observedGeneration: 1, readyReplicas: 1 },
      })
    ).toBe(false);
  });

  it("uses DaemonSet scheduling fields", () => {
    expect(
      isKubernetesResourceReady("DaemonSet", {
        status: { desiredNumberScheduled: 3, numberReady: 3 },
      })
    ).toBe(true);
  });

  it("accepts an active CronJob but rejects an explicitly suspended one", () => {
    expect(isKubernetesResourceReady("CronJob", { spec: {} })).toBe(true);
    expect(
      isKubernetesResourceReady("CronJob", { spec: { suspend: true } })
    ).toBe(false);
    expect(isKubernetesRuntimeResourceKind("CronJob")).toBe(true);
  });

  it("requires Pod Ready instead of Running phase", () => {
    expect(
      isKubernetesResourceReady("Pod", {
        conditions: [{ status: "False", type: "Ready" }],
        status: { phase: "Running" },
      })
    ).toBe(false);
  });
});
