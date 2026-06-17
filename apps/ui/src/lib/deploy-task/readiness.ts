import type { DeploymentResultResourceCardStatus } from "./timeline";

export interface DeploymentResultReadiness {
  eventMessage: string;
  latestStatusText: string;
  status: DeploymentResultResourceCardStatus;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePhase(value: unknown): string {
  return stringValue(value)?.toLowerCase() ?? "unknown";
}

export function apWorkloadReadinessFromProductView(
  ap: unknown
): DeploymentResultReadiness {
  const status = objectValue(objectValue(ap)?.status);
  const phaseRaw = stringValue(status?.phase) ?? "Unknown";
  const phase = normalizePhase(phaseRaw);
  const readyReplicas = numberValue(status?.readyReplicas) ?? 0;
  const replicas = Math.max(numberValue(status?.replicas) ?? 1, 1);
  const latestStatusText = `${phaseRaw}, ${readyReplicas}/${replicas} replicas ready`;

  if (readyReplicas >= replicas) {
    return {
      eventMessage: `AP workload has ${readyReplicas}/${replicas} ready replicas.`,
      latestStatusText: `${readyReplicas}/${replicas} replicas ready`,
      status: "running",
    };
  }

  if (phase === "failed" || phase === "error") {
    return {
      eventMessage: "AP workload failed before reaching ready replicas.",
      latestStatusText,
      status: "failed",
    };
  }

  if (phase === "blocked") {
    return {
      eventMessage: `AP workload is blocked with ${readyReplicas}/${replicas} ready replicas.`,
      latestStatusText,
      status: "blocked",
    };
  }

  if (phase === "unknown") {
    return {
      eventMessage: `AP workload state is unknown with ${readyReplicas}/${replicas} ready replicas.`,
      latestStatusText,
      status: "unknown",
    };
  }

  return {
    eventMessage: `AP workload is ${phaseRaw} with ${readyReplicas}/${replicas} ready replicas.`,
    latestStatusText,
    status: "creating",
  };
}
