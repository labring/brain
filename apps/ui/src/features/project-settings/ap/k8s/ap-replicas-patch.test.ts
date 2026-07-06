import assert from "node:assert/strict";
import { test } from "node:test";

import {
  apMergePatchFromJsonPatchOps,
  patchOpsForApResourceQuotaSettings,
  patchOpsForApSettingsDraft,
} from "./ap-json-patch";

// Rendered AP spec as apps/api returns it for a Deployment with
// spec.replicas=1 and a fixed/1 replicaStrategy annotation. The resource
// subtree always carries both the legacy `replicas` field and the strategy.
function renderedApSpec(): Record<string, unknown> {
  return {
    input: {
      env: [],
      image: "nginx:1.27",
      network: { appListeningPorts: [{ port: 80 }], privatePort: 80 },
    },
    name: "web",
    paused: false,
    resource: {
      limits: { cpu: "500m", memory: "512Mi" },
      replicaStrategy: { fixed: { replicas: 1 }, type: "fixed" },
      replicas: 1,
      requests: { cpu: "50m", memory: "51Mi" },
    },
    workload: { kind: "deployment" },
  };
}

function patchResource(
  ops: Parameters<typeof apMergePatchFromJsonPatchOps>[0]
) {
  const patch = apMergePatchFromJsonPatchOps(ops) as {
    spec?: { resource?: Record<string, unknown> };
  };
  const resource = patch.spec?.resource;
  assert.ok(resource, "expected patch to carry spec.resource");
  return resource;
}

test("AP settings draft replica change keeps legacy replicas aligned with the fixed strategy", () => {
  const ops = patchOpsForApSettingsDraft(
    renderedApSpec(),
    {
      cpuCores: 0.5,
      memoryMib: 512,
      replicaStrategy: { fixed: { replicas: 3 }, type: "fixed" },
      replicas: 3,
    },
    {
      cpuCores: 0.5,
      memoryMib: 512,
      replicaStrategy: { fixed: { replicas: 1 }, type: "fixed" },
      replicas: 1,
    }
  );

  const resource = patchResource(ops);
  assert.deepEqual(resource.replicaStrategy, {
    fixed: { replicas: 3 },
    type: "fixed",
  });
  // The stale rendered value must not be echoed back: apps/api scales the
  // workload by the legacy field when it disagrees with the strategy.
  assert.equal(resource.replicas, 3);
});

test("AP resource quota patch with bare replicas emits a consistent fixed strategy", () => {
  const ops = patchOpsForApResourceQuotaSettings(renderedApSpec(), {
    replicas: 5,
  });

  const resource = patchResource(ops);
  assert.deepEqual(resource.replicaStrategy, {
    fixed: { replicas: 5 },
    type: "fixed",
  });
  assert.equal(resource.replicas, 5);
});

test("AP elastic strategy patch leaves workload scaling to the autoscaler", () => {
  const ops = patchOpsForApResourceQuotaSettings(renderedApSpec(), {
    replicaStrategy: {
      elastic: {
        maxReplicas: 8,
        minReplicas: 2,
        target: { metric: "cpu", type: "utilization", utilizationPercent: 75 },
      },
      fixed: { replicas: 1 },
      type: "elastic",
    },
  });

  const resource = patchResource(ops);
  const strategy = resource.replicaStrategy as { type?: string };
  assert.equal(strategy.type, "elastic");
  // Elastic keeps the rendered legacy value untouched; the HPA owns scale.
  assert.equal(resource.replicas, 1);
});
