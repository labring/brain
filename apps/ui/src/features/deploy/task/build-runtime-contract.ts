import type { DevboxInfo } from "@/lib/devbox/types";
import {
  DEPLOY_TIMEOUT_POLICY,
  remainingDeploymentTimeoutSeconds,
} from "./timeout-policy";

const DEPLOY_WORKSPACE_DIR = "/home/devbox/project";
const KANIKO_CONTEXT_BUCKET = "kaniko-context";
const KANIKO_CONTEXT_REGION = "sealos-internal";
const KANIKO_CONTEXT_ACCESS_KEY_ID = "admin";
const KANIKO_CONTEXT_SECRET_KEY = "SEALOS_DEVBOX_JWT_SECRET";

export function buildRuntimeContract(input: {
  deadlineAtMs: number;
  devbox: DevboxInfo;
  networkId?: string | null;
  nowMs?: number;
}): Record<string, unknown> | null {
  const networkId =
    input.networkId?.trim() || input.devbox.network?.uniqueID?.trim();
  if (!networkId) {
    return null;
  }
  const buildDeadlineSeconds = remainingDeploymentTimeoutSeconds({
    capMs: DEPLOY_TIMEOUT_POLICY.imageBuildSeconds * 1000,
    deadlineAtMs: input.deadlineAtMs,
    nowMs: input.nowMs,
  });
  if (buildDeadlineSeconds <= 0) {
    throw new Error("Build runtime deadline has elapsed.");
  }
  return {
    accessKeyId: KANIKO_CONTEXT_ACCESS_KEY_ID,
    buildDeadlineAt: new Date(input.deadlineAtMs).toISOString(),
    buildDeadlineSeconds,
    bucket: KANIKO_CONTEXT_BUCKET,
    devboxName: input.devbox.name,
    region: KANIKO_CONTEXT_REGION,
    s3Endpoint: `http://${networkId}:1319`,
    secretKeyRef: {
      key: KANIKO_CONTEXT_SECRET_KEY,
      name: input.devbox.name,
    },
    workspaceDir: DEPLOY_WORKSPACE_DIR,
  };
}
