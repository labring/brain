import { isKubernetesRuntimeResourceKind } from "./kubernetes-resource-readiness";
import type {
  ManagedAccessEndpoint,
  ManagedResourceRef,
} from "./managed-deployment-contract";
import {
  attachDeploymentTaskSuccess,
  type DeploymentResultResourceCard,
  type DeploymentResultResourceRef,
  type DeploymentTaskTimelineSnapshot,
  deploymentResultResourceCardId,
  deploymentTaskSuccessFromTimeline,
  upsertResultResourceCard,
} from "./timeline";

function runningCard(input: {
  latestStatusText: string;
  ref: DeploymentResultResourceRef;
  title: string;
}): DeploymentResultResourceCard {
  return {
    events: [],
    id: deploymentResultResourceCardId(input.ref),
    latestStatusText: input.latestStatusText,
    required: true,
    resultRef: input.ref,
    status: "running",
    title: input.title,
  };
}

/**
 * Projects only the independently verified, user-relevant managed results into
 * the Timeline. Supporting objects such as Services, Ingresses and PVCs remain
 * in the artifact summary but are not presented as separate readiness checks.
 */
export function managedDeploymentTimelineResultCards(input: {
  accessEndpoints: readonly ManagedAccessEndpoint[];
  namespace: string;
  resources: readonly ManagedResourceRef[];
}): DeploymentResultResourceCard[] {
  const workloadCards = input.resources.flatMap((resource) => {
    if (!isKubernetesRuntimeResourceKind(resource.kind)) {
      return [];
    }
    const ref: DeploymentResultResourceRef = {
      apiVersion: resource.apiVersion,
      kind: "KubernetesWorkload",
      name: resource.name,
      namespace: resource.namespace,
      workloadKind: resource.kind,
    };
    return [
      runningCard({
        latestStatusText: `${resource.kind} ${resource.name} is ready.`,
        ref,
        title: resource.name,
      }),
    ];
  });
  const endpointCards = input.accessEndpoints.map((endpoint) => {
    const parsed = new URL(endpoint.url);
    const ref: DeploymentResultResourceRef = {
      id: endpoint.id,
      kind: "AccessEndpoint",
      label: endpoint.label,
      namespace: input.namespace,
      observer: { kind: "declared" },
      protocol: parsed.protocol.slice(0, -1) as "http" | "https" | "ws" | "wss",
      url: endpoint.url,
    };
    return runningCard({
      latestStatusText: `${endpoint.label} is reachable.`,
      ref,
      title: endpoint.label,
    });
  });
  const unique = new Map<string, DeploymentResultResourceCard>();
  for (const card of [...workloadCards, ...endpointCards]) {
    unique.set(card.id, card);
  }
  return [...unique.values()];
}

/** Writes managed evidence first, then derives the success claim from it. */
export function attachManagedDeploymentTimelineSuccess(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    accessEndpoints: readonly ManagedAccessEndpoint[];
    namespace: string;
    productName: string | null;
    resources: readonly ManagedResourceRef[];
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  const cards = managedDeploymentTimelineResultCards({
    accessEndpoints: input.accessEndpoints,
    namespace: input.namespace,
    resources: input.resources.map((resource) => ({
      ...resource,
      namespace: input.namespace,
    })),
  });
  const withEvidence = cards.reduce(
    (current, card) =>
      upsertResultResourceCard(current, {
        card,
        stepId: "create-resources",
        updatedAt: input.updatedAt,
      }),
    timeline
  );
  const success = deploymentTaskSuccessFromTimeline(withEvidence, {
    productName: input.productName,
  });
  return success == null
    ? withEvidence
    : attachDeploymentTaskSuccess(withEvidence, {
        success,
        updatedAt: input.updatedAt,
      });
}
