export interface KubernetesReadinessSnapshot {
  conditions?: readonly Record<string, unknown>[];
  endpointsReady?: number | null;
  generation?: number | null;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

const RUNTIME_RESOURCE_KINDS = new Set([
  "cronjob",
  "daemonset",
  "deployment",
  "job",
  "pod",
  "statefulset",
]);

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function conditionTrue(
  conditions: readonly Record<string, unknown>[],
  type: string
): boolean {
  return conditions.some(
    (condition) =>
      condition.type === type &&
      String(condition.status).toLowerCase() === "true"
  );
}

function phaseReady(status: Record<string, unknown>): boolean {
  const phase = String(status.phase ?? "").toLowerCase();
  return ["completed", "deployed", "ready", "running", "succeeded"].includes(
    phase
  );
}

function observedCurrentGeneration(
  input: KubernetesReadinessSnapshot
): boolean {
  const observedGeneration = numberValue(input.status?.observedGeneration);
  return !(
    input.generation != null &&
    observedGeneration != null &&
    observedGeneration < input.generation
  );
}

type ResourceReadinessEvaluator = (
  input: Required<
    Pick<KubernetesReadinessSnapshot, "conditions" | "spec" | "status">
  > &
    KubernetesReadinessSnapshot
) => boolean;

const resourceReadinessEvaluators: Record<string, ResourceReadinessEvaluator> =
  {
    cronjob: ({ spec }) => spec.suspend !== true,
    daemonset: ({ status }) => {
      const scheduled = numberValue(status.desiredNumberScheduled) ?? 0;
      return (
        scheduled > 0 && (numberValue(status.numberReady) ?? 0) >= scheduled
      );
    },
    deployment: ({ spec, status }) => {
      const desired = Math.max(numberValue(spec.replicas) ?? 1, 1);
      return (numberValue(status.readyReplicas) ?? 0) >= desired;
    },
    job: ({ conditions }) => conditionTrue(conditions, "Complete"),
    persistentvolumeclaim: ({ status }) =>
      String(status.phase).toLowerCase() === "bound",
    pod: ({ conditions }) => conditionTrue(conditions, "Ready"),
    service: ({ endpointsReady, spec }) =>
      spec.type === "ExternalName" || (endpointsReady ?? 0) > 0,
    statefulset: ({ spec, status }) => {
      const desired = Math.max(numberValue(spec.replicas) ?? 1, 1);
      return (numberValue(status.readyReplicas) ?? 0) >= desired;
    },
  };

const EXISTENCE_READY_KINDS = new Set([
  "configmap",
  "ingress",
  "networkpolicy",
  "role",
  "rolebinding",
  "secret",
  "serviceaccount",
]);

const SIGNAL_REQUIRED_KINDS = new Set([
  "app",
  "certificate",
  "cluster",
  "instance",
  "issuer",
  "objectstoragebucket",
]);

export function isKubernetesRuntimeResourceKind(kind: string): boolean {
  return RUNTIME_RESOURCE_KINDS.has(kind.toLowerCase());
}

/**
 * Shared task-facing readiness policy for raw Kubernetes resources.
 * Controllers and the Agent-managed verifier must use the same predicate for
 * the same Kind so deployment completion cannot depend on the runner path.
 */
export function isKubernetesResourceReady(
  kindValue: string,
  input: KubernetesReadinessSnapshot
): boolean {
  const kind = kindValue.toLowerCase();
  const conditions = input.conditions ?? [];
  const spec = input.spec ?? {};
  const status = input.status ?? {};

  if (!observedCurrentGeneration(input)) {
    return false;
  }
  const evaluator = resourceReadinessEvaluators[kind];
  if (evaluator != null) {
    return evaluator({ ...input, conditions, spec, status });
  }
  if (EXISTENCE_READY_KINDS.has(kind)) {
    return true;
  }

  const readinessRequired = SIGNAL_REQUIRED_KINDS.has(kind);
  const hasReadinessSignal =
    conditions.length > 0 || typeof status.phase === "string";
  if (!(readinessRequired || hasReadinessSignal)) {
    return true;
  }
  return conditionTrue(conditions, "Ready") || phaseReady(status);
}
