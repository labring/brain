import type {
  DeploymentTaskRunner,
  DeployTaskArtifactSummary,
  DeployTaskEventPayload,
} from "./schema";
import { withoutSensitiveArgs } from "./sensitive-inputs";

const AI_PRIVATE_EVENT_PAYLOAD_KEY_RE =
  /authorization|bearer|body|credential|error|log|password|recent.?events|secret|stderr|stdout|text|token|transcript|api.?key/i;

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
  summary: DeployTaskArtifactSummary,
  options?: { runner?: DeploymentTaskRunner }
): DeployTaskArtifactSummary {
  const {
    buildResult,
    deliveryManifest: _deliveryManifest,
    deploymentPlan,
    outputJson: _outputJson,
    resourceYamls,
    ...publicSummary
  } = summary;
  const publicPlan = publicDeploymentPlan(deploymentPlan);
  return {
    ...publicSummary,
    ...(options?.runner?.kind === "ai" || buildResult === undefined
      ? {}
      : { buildResult }),
    ...(publicPlan == null ? {} : { deploymentPlan: publicPlan }),
    ...(publicPlan == null && resourceYamls !== undefined
      ? { resourceYamls }
      : {}),
  };
}

function publicAiEventPayloadValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => publicAiEventPayloadValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  const record = recordValue(value);
  if (record == null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      if (AI_PRIVATE_EVENT_PAYLOAD_KEY_RE.test(key)) {
        return [];
      }
      const publicItem = publicAiEventPayloadValue(item, depth + 1);
      return publicItem === undefined ? [] : [[key, publicItem]];
    })
  );
}

export function publicDeployTaskEventPayload(
  payload: DeployTaskEventPayload,
  options?: { eventKind?: string; runner?: DeploymentTaskRunner }
): DeployTaskEventPayload {
  const isAiRunner = options?.runner?.kind === "ai";
  if (isAiRunner && options.eventKind?.startsWith("deploy_task.gateway_")) {
    return {};
  }
  const publicPayload = isAiRunner
    ? (publicAiEventPayloadValue(payload) as DeployTaskEventPayload)
    : payload;
  const artifactSummary = recordValue(publicPayload.artifactSummary);
  if (artifactSummary == null) {
    return publicPayload;
  }
  return {
    ...publicPayload,
    artifactSummary: publicDeployTaskArtifactSummary(
      artifactSummary as DeployTaskArtifactSummary,
      { runner: options?.runner }
    ),
  };
}
