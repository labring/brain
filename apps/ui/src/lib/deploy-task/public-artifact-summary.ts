import type {
  DeployTaskArtifactSummary,
  DeployTaskEventPayload,
} from "./schema";
import { withoutSensitiveArgs } from "./sensitive-inputs";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function publicDeploymentPlan(
  plan: DeployTaskArtifactSummary["deploymentPlan"]
): DeployTaskArtifactSummary["deploymentPlan"] {
  if (plan == null) {
    return undefined;
  }
  return {
    ...plan,
    ...(plan.args == null
      ? {}
      : { args: withoutSensitiveArgs(plan.args, plan.inputs) }),
  };
}

export function publicDeployTaskArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeployTaskArtifactSummary {
  const {
    deliveryManifest: _deliveryManifest,
    deploymentPlan,
    outputJson: _outputJson,
    resourceYamls,
    ...publicSummary
  } = summary;
  const publicPlan = publicDeploymentPlan(deploymentPlan);
  return {
    ...publicSummary,
    ...(publicPlan == null ? {} : { deploymentPlan: publicPlan }),
    ...(publicPlan == null && resourceYamls !== undefined
      ? { resourceYamls }
      : {}),
  };
}

export function publicDeployTaskEventPayload(
  payload: DeployTaskEventPayload
): DeployTaskEventPayload {
  const artifactSummary = recordValue(payload.artifactSummary);
  if (artifactSummary == null) {
    return payload;
  }
  return {
    ...payload,
    artifactSummary: publicDeployTaskArtifactSummary(
      artifactSummary as DeployTaskArtifactSummary
    ),
  };
}
