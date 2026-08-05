import { Buffer } from "node:buffer";
import { z } from "zod";

import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";

import type {
  ManagedResourceRef,
  ManagedVerifyReport,
} from "./managed-deployment-contract";

const observationSchema = z
  .object({
    endpointsReady: z.number().int().nonnegative().nullable(),
    error: z.string().max(4000).nullable(),
    resource: z
      .object({
        apiVersion: z.string(),
        kind: z.string(),
        name: z.string(),
        namespace: z.string(),
      })
      .strict(),
    snapshot: z
      .object({
        conditions: z.array(z.record(z.string(), z.unknown())),
        generation: z.number().int().nonnegative().nullable(),
        labels: z.record(z.string(), z.string()),
        ownerReferences: z.array(
          z.object({ kind: z.string(), name: z.string() }).strict()
        ),
        spec: z.record(z.string(), z.unknown()),
        status: z.record(z.string(), z.unknown()),
      })
      .strict()
      .nullable(),
  })
  .strict();

const observationsSchema = z.array(observationSchema).max(257);
export type ManagedResourceObservation = z.infer<typeof observationSchema>;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildManagedResourceObservationCommand(
  resources: readonly ManagedResourceRef[]
): string {
  const encoded = Buffer.from(JSON.stringify(resources), "utf8").toString(
    "base64"
  );
  const script = [
    'const { spawnSync } = require("node:child_process");',
    'const refs = JSON.parse(Buffer.from(process.env.SEALAI_VERIFY_REFS, "base64").toString("utf8"));',
    "const observations = refs.map((resource) => {",
    "  const result = spawnSync('kubectl', ['get', resource.kind, resource.name, '-n', resource.namespace, '-o', 'json'], { encoding: 'utf8' });",
    "  if (result.status !== 0) return { endpointsReady: null, error: String(result.stderr || result.stdout || 'resource observation failed').trim().slice(0, 4000), resource, snapshot: null };",
    "  const object = JSON.parse(result.stdout); const metadata = object.metadata || {}; const status = object.status || {}; const spec = object.spec || {};",
    "  let endpointsReady = null;",
    "  if (resource.kind.toLowerCase() === 'service') {",
    "    const endpoints = spawnSync('kubectl', ['get', 'endpoints', resource.name, '-n', resource.namespace, '-o', 'json'], { encoding: 'utf8' });",
    "    if (endpoints.status === 0) { const value = JSON.parse(endpoints.stdout); endpointsReady = (value.subsets || []).reduce((count, subset) => count + (subset.addresses || []).length, 0); } else endpointsReady = 0;",
    "  }",
    "  return { endpointsReady, error: null, resource, snapshot: { conditions: Array.isArray(status.conditions) ? status.conditions : [], generation: Number.isInteger(metadata.generation) ? metadata.generation : null, labels: metadata.labels || {}, ownerReferences: (metadata.ownerReferences || []).map((owner) => ({ kind: owner.kind, name: owner.name })), spec, status } };",
    "});",
    "process.stdout.write(JSON.stringify(observations));",
  ].join(" ");
  return `SEALAI_VERIFY_REFS=${shellQuote(encoded)} node -e ${shellQuote(script)}`;
}

export function parseManagedResourceObservations(
  contents: string
): ManagedResourceObservation[] {
  return observationsSchema.parse(JSON.parse(contents));
}

export function managedIngressHosts(
  observations: readonly ManagedResourceObservation[]
): string[] {
  const hosts = new Set<string>();
  for (const observation of observations) {
    if (
      observation.resource.kind.toLowerCase() !== "ingress" ||
      observation.snapshot == null
    ) {
      continue;
    }
    const rules = observation.snapshot.spec.rules;
    if (!Array.isArray(rules)) {
      continue;
    }
    for (const rule of rules) {
      if (rule == null || typeof rule !== "object") {
        continue;
      }
      const host = (rule as { host?: unknown }).host;
      if (typeof host === "string" && host.trim() !== "") {
        hosts.add(host.trim().toLowerCase());
      }
    }
  }
  return [...hosts];
}

export function managedIdentityNetworkHosts(input: {
  identityResources: readonly ManagedResourceRef[];
  instanceName: string;
  observations: readonly ManagedResourceObservation[];
  projectId: string;
}): { publicHosts: string[]; serviceHosts: string[] } {
  const identityKeys = new Set(
    input.identityResources.map(resourceIdentityKey)
  );
  const owned = input.observations.filter((observation) =>
    belongsToIdentity(observation, input, identityKeys)
  );
  return {
    publicHosts: managedIngressHosts(owned),
    serviceHosts: owned.flatMap((observation) =>
      observation.resource.kind.toLowerCase() === "service"
        ? [
            `${observation.resource.name}.${observation.resource.namespace}.svc.cluster.local`,
          ]
        : []
    ),
  };
}

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

function workloadReady(observation: ManagedResourceObservation): boolean {
  const snapshot = observation.snapshot;
  if (snapshot == null) {
    return false;
  }
  const kind = observation.resource.kind.toLowerCase();
  const desired = numberValue(snapshot.spec.replicas) ?? 1;
  const observedGeneration = numberValue(snapshot.status.observedGeneration);
  if (
    snapshot.generation != null &&
    observedGeneration != null &&
    observedGeneration < snapshot.generation
  ) {
    return false;
  }
  if (kind === "deployment") {
    return (
      (numberValue(snapshot.status.readyReplicas) ?? 0) >= desired &&
      (numberValue(snapshot.status.availableReplicas) ?? 0) >= desired
    );
  }
  if (kind === "statefulset") {
    return (numberValue(snapshot.status.readyReplicas) ?? 0) >= desired;
  }
  if (kind === "daemonset") {
    const scheduled = numberValue(snapshot.status.desiredNumberScheduled) ?? 0;
    return (
      scheduled > 0 &&
      (numberValue(snapshot.status.numberReady) ?? 0) >= scheduled
    );
  }
  return false;
}

function resourceReady(observation: ManagedResourceObservation): boolean {
  const snapshot = observation.snapshot;
  if (snapshot == null || observation.error != null) {
    return false;
  }
  const kind = observation.resource.kind.toLowerCase();
  if (["deployment", "statefulset", "daemonset"].includes(kind)) {
    return workloadReady(observation);
  }
  if (kind === "job") {
    return conditionTrue(snapshot.conditions, "Complete");
  }
  if (kind === "service") {
    return (
      snapshot.spec.type === "ExternalName" ||
      (observation.endpointsReady ?? 0) > 0
    );
  }
  if (kind === "persistentvolumeclaim") {
    return String(snapshot.status.phase).toLowerCase() === "bound";
  }
  if (
    [
      "configmap",
      "cronjob",
      "ingress",
      "networkpolicy",
      "role",
      "rolebinding",
      "secret",
      "serviceaccount",
    ].includes(kind)
  ) {
    return true;
  }
  const readinessRequired = [
    "app",
    "certificate",
    "cluster",
    "instance",
    "issuer",
    "objectstoragebucket",
  ].includes(kind);
  const hasReadinessSignal =
    snapshot.conditions.length > 0 || typeof snapshot.status.phase === "string";
  if (!(readinessRequired || hasReadinessSignal)) {
    return true;
  }
  return (
    conditionTrue(snapshot.conditions, "Ready") || phaseReady(snapshot.status)
  );
}

function resourceIdentityKey(resource: {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
}): string {
  return [
    resource.apiVersion,
    resource.kind,
    resource.namespace,
    resource.name,
  ].join("|");
}

function belongsToIdentity(
  observation: ManagedResourceObservation,
  input: { instanceName: string; projectId: string },
  identityKeys: ReadonlySet<string>
): boolean {
  const snapshot = observation.snapshot;
  if (
    snapshot == null ||
    !identityKeys.has(resourceIdentityKey(observation.resource))
  ) {
    return false;
  }
  if (
    observation.resource.kind === "Instance" &&
    observation.resource.name === input.instanceName
  ) {
    return snapshot.labels[BRAIN_PROJECT_ID_LABEL] === input.projectId;
  }
  return true;
}

export interface ManagedBrainVerificationResult {
  ok: boolean;
  violations: string[];
}

export function verifyManagedResourceObservations(input: {
  identityResources: readonly ManagedResourceRef[];
  instanceName: string;
  observations: readonly ManagedResourceObservation[];
  projectId: string;
  report: ManagedVerifyReport;
}): ManagedBrainVerificationResult {
  const violations: string[] = [];
  const identityKeys = new Set(
    input.identityResources.map(resourceIdentityKey)
  );
  const instance = input.observations.find(
    (observation) =>
      observation.resource.kind === "Instance" &&
      observation.resource.name === input.instanceName
  );
  if (instance == null) {
    violations.push("allocated Instance was not observed");
  }
  if (
    !input.observations.some((observation) =>
      [
        "cluster",
        "cronjob",
        "daemonset",
        "deployment",
        "job",
        "statefulset",
      ].includes(observation.resource.kind.toLowerCase())
    )
  ) {
    violations.push("no runtime workload was observed");
  }
  for (const observation of input.observations) {
    const label = `${observation.resource.kind}/${observation.resource.name}`;
    if (observation.error != null || observation.snapshot == null) {
      violations.push(`${label} could not be observed`);
      continue;
    }
    if (
      !belongsToIdentity(
        observation,
        {
          instanceName: input.instanceName,
          projectId: input.projectId,
        },
        identityKeys
      )
    ) {
      violations.push(`${label} is outside the allocated identity`);
    }
    if (!resourceReady(observation)) {
      violations.push(`${label} is not ready`);
    }
  }
  if (input.report.verdict !== "passed") {
    violations.push("Agent verification report did not pass");
  }
  return { ok: violations.length === 0, violations };
}
