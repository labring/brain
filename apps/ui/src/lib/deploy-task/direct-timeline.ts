import type { DeploymentResultReadiness } from "./readiness";
import type { DeployTaskArtifactSummary } from "./schema";
import {
  type DeploymentResultResourceCard,
  deploymentResultResourceCardId,
} from "./timeline";

export function apResultResourceCardsFromArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeploymentResultResourceCard[] {
  return (summary.resources ?? []).flatMap((resource) => {
    if (resource.apiVersion !== "brain.io/direct" || resource.kind !== "AP") {
      return [];
    }
    const resultRef = {
      kind: "AP" as const,
      name: resource.name,
      namespace: resource.namespace,
    };
    return [
      {
        events: [],
        id: deploymentResultResourceCardId(resultRef),
        required: true,
        resultRef,
        status: "creating",
        title: resource.name,
      },
    ];
  });
}

export function applyApReadinessToResultCard(
  card: DeploymentResultResourceCard,
  readiness: DeploymentResultReadiness
): DeploymentResultResourceCard {
  return {
    ...card,
    latestStatusText: readiness.latestStatusText,
    status: readiness.status,
  };
}
