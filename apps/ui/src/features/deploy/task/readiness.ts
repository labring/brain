import { isKubernetesResourceReady } from "./kubernetes-resource-readiness";
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

export function dbServiceReadinessFromProductView(
  db: unknown
): DeploymentResultReadiness {
  const status = objectValue(objectValue(db)?.status);
  const phaseRaw = stringValue(status?.phase) ?? "Unknown";
  const phase = normalizePhase(phaseRaw);

  if (phase === "running") {
    return {
      eventMessage: "DB Service is Running.",
      latestStatusText: phaseRaw,
      status: "running",
    };
  }

  if (phase === "failed" || phase === "error") {
    return {
      eventMessage: "DB Service failed before reaching Running.",
      latestStatusText: phaseRaw,
      status: "failed",
    };
  }

  if (phase === "blocked") {
    return {
      eventMessage: "DB Service is blocked before reaching Running.",
      latestStatusText: phaseRaw,
      status: "blocked",
    };
  }

  if (phase === "unknown") {
    return {
      eventMessage: "DB Service state is unknown.",
      latestStatusText: phaseRaw,
      status: "unknown",
    };
  }

  return {
    eventMessage: `DB Service is ${phaseRaw}.`,
    latestStatusText: phaseRaw,
    status: "creating",
  };
}

export function templateWorkloadReadinessFromProductView(
  workload: unknown,
  workloadKind?: string
): DeploymentResultReadiness {
  const record = objectValue(workload);
  const metadata = objectValue(record?.metadata);
  const spec = objectValue(record?.spec) ?? {};
  const status = objectValue(record?.status) ?? {};
  const kind = stringValue(record?.kind) ?? workloadKind ?? "Deployment";
  const phaseRaw = stringValue(status?.phase) ?? "Progressing";
  const phase = normalizePhase(phaseRaw);
  const normalizedKind = kind.toLowerCase();
  const readyReplicas =
    normalizedKind === "daemonset"
      ? (numberValue(status.numberReady) ?? 0)
      : (numberValue(status.readyReplicas) ?? 0);
  const replicas = Math.max(
    normalizedKind === "daemonset"
      ? (numberValue(status.desiredNumberScheduled) ?? 1)
      : (numberValue(spec.replicas) ?? numberValue(status.replicas) ?? 1),
    1
  );
  const latestStatusText = `${phaseRaw}, ${readyReplicas}/${replicas} replicas ready`;
  const conditions = Array.isArray(status.conditions)
    ? status.conditions.flatMap((condition) => {
        const value = objectValue(condition);
        return value == null ? [] : [value];
      })
    : [];
  const ready = isKubernetesResourceReady(kind, {
    conditions,
    generation: numberValue(metadata?.generation),
    spec: {
      ...spec,
      replicas: numberValue(spec.replicas) ?? numberValue(status.replicas) ?? 1,
    },
    status,
  });

  if (ready) {
    if (normalizedKind === "cronjob") {
      return {
        eventMessage: "Template CronJob schedule is active.",
        latestStatusText: "Schedule active",
        status: "running",
      };
    }
    return {
      eventMessage: `Template workload has ${readyReplicas}/${replicas} ready replicas.`,
      latestStatusText: `${readyReplicas}/${replicas} replicas ready`,
      status: "running",
    };
  }

  if (phase === "failed" || phase === "error") {
    return {
      eventMessage: "Template workload failed before reaching ready replicas.",
      latestStatusText,
      status: "failed",
    };
  }

  if (phase === "blocked") {
    return {
      eventMessage: `Template workload is blocked with ${readyReplicas}/${replicas} ready replicas.`,
      latestStatusText,
      status: "blocked",
    };
  }

  if (phase === "unknown") {
    return {
      eventMessage: `Template workload state is unknown with ${readyReplicas}/${replicas} ready replicas.`,
      latestStatusText,
      status: "unknown",
    };
  }

  return {
    eventMessage: `Template workload is ${phaseRaw} with ${readyReplicas}/${replicas} ready replicas.`,
    latestStatusText,
    status: "creating",
  };
}

export function publicAccessReadinessFromProductView(
  publicAddress: unknown
): DeploymentResultReadiness {
  const record = objectValue(publicAddress);
  const statusRaw =
    stringValue(record?.status) ??
    stringValue(record?.state) ??
    stringValue(record?.phase) ??
    "unknown";
  const status = normalizePhase(statusRaw);

  if (status === "accessible" || status === "ready" || status === "running") {
    return {
      eventMessage: "Public Address is accessible.",
      latestStatusText: statusRaw,
      status: "running",
    };
  }

  if (status === "blocked") {
    return {
      eventMessage: "Public Address is blocked.",
      latestStatusText: statusRaw,
      status: "blocked",
    };
  }

  if (status === "failed" || status === "error") {
    return {
      eventMessage: "Public Address failed before becoming accessible.",
      latestStatusText: statusRaw,
      status: "failed",
    };
  }

  if (status === "unknown") {
    return {
      eventMessage: "Public Address state is unknown.",
      latestStatusText: statusRaw,
      status: "unknown",
    };
  }

  return {
    eventMessage: `Public Address is ${statusRaw}.`,
    latestStatusText: statusRaw,
    status: "creating",
  };
}
