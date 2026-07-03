import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import { ContainerNode } from "@workspace/ui/components/container-node/container-node";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const REPLICAS_METRIC_RE = /Replicas: ([^<]*)</;

function renderedReplicasMetric(
  states: Partial<ContainerNodeStates>
): string | undefined {
  const markup = renderToStaticMarkup(
    createElement(
      ContainerNode.Root,
      {
        states: {
          image: "registry.example.io/demo:v1",
          kind: "AP",
          name: "demo",
          status: { label: "Running", tone: "running" },
          ...states,
        },
      },
      createElement(ContainerNode.Content)
    )
  );
  return REPLICAS_METRIC_RE.exec(markup)?.[1];
}

test("container node replicas metric collapses to one number when converged", () => {
  assert.equal(renderedReplicasMetric({ readyReplicas: 3, replicas: 3 }), "3");
});

test("container node replicas metric shows ready/desired while diverged", () => {
  assert.equal(
    renderedReplicasMetric({ readyReplicas: 1, replicas: 3 }),
    "1/3"
  );
});

test("container node replicas metric falls back to desired without status", () => {
  assert.equal(renderedReplicasMetric({ replicas: 3 }), "3");
});

test("container node replicas metric shows zero for paused workloads", () => {
  assert.equal(renderedReplicasMetric({ readyReplicas: 0, replicas: 0 }), "0");
});
