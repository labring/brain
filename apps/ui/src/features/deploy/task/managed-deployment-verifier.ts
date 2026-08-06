import { Buffer } from "node:buffer";
import { z } from "zod";

import {
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_PROJECT_ID_LABEL,
} from "@/lib/brain-labels";

import {
  type ManagedResourceRef,
  managedResourceRefSchema,
} from "./managed-deployment-contract";

export const MANAGED_READINESS_RESOURCE_TYPES = [
  "instances.app.sealos.io",
  "apps.app.sealos.io",
  "deployments.apps",
  "statefulsets.apps",
  "daemonsets.apps",
  "jobs.batch",
  "cronjobs.batch",
  "pods",
  "services",
  "ingresses.networking.k8s.io",
  "clusters.apps.kubeblocks.io",
  "persistentvolumeclaims",
  "certificates.cert-manager.io",
  "issuers.cert-manager.io",
  "objectstoragebuckets.objectstorage.sealos.io",
] as const;

const MAX_VERIFICATION_RESOURCES = 257;
const RESOURCE_QUERY_CONCURRENCY = 8;
const RESOURCE_QUERY_TIMEOUT = "10s";
const RESOURCE_QUERY_BATCH_TIMEOUT_MS = 50_000;

const discoverySchema = z
  .object({
    errors: z.array(z.string().max(4000)).max(64),
    resources: z.array(managedResourceRefSchema).max(256),
  })
  .strict();

export type ManagedResourceDiscovery = z.infer<typeof discoverySchema>;

const observationSchema = z
  .object({
    endpointsReady: z.number().int().nonnegative().nullable(),
    error: z.string().max(4000).nullable(),
    resource: managedResourceRefSchema,
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

const observationsSchema = z
  .array(observationSchema)
  .max(MAX_VERIFICATION_RESOURCES);
export type ManagedResourceObservation = z.infer<typeof observationSchema>;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildManagedResourceDiscoveryCommand(input: {
  instanceName: string;
  namespace: string;
  projectId: string;
}): string {
  const encoded = Buffer.from(
    JSON.stringify({
      concurrency: RESOURCE_QUERY_CONCURRENCY,
      deploymentLabel: BRAIN_DEPLOYMENT_NAME_LABEL,
      instanceName: input.instanceName,
      maxResources: 256,
      namespace: input.namespace,
      projectId: input.projectId,
      projectLabel: BRAIN_PROJECT_ID_LABEL,
      requestTimeout: RESOURCE_QUERY_TIMEOUT,
      resourceTypes: MANAGED_READINESS_RESOURCE_TYPES,
    }),
    "utf8"
  ).toString("base64");
  const script = [
    'const { spawn } = require("node:child_process");',
    'const input = JSON.parse(Buffer.from(process.env.SEALAI_DISCOVERY_INPUT, "base64").toString("utf8"));',
    "const results = new Array(input.resourceTypes.length); let cursor = 0;",
    "const run = (resourceType) => new Promise((resolve) => {",
    "  const args = ['get', resourceType, '-n', input.namespace, '-l', input.projectLabel + '=' + input.projectId + ',' + input.deploymentLabel + '=' + input.instanceName, '-o', 'json', '--request-timeout=' + input.requestTimeout];",
    "  const child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';",
    "  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });",
    "  child.on('error', (error) => resolve({ error: resourceType + ': ' + error.message, resources: [] }));",
    "  child.on('close', (code) => {",
    "    if (code !== 0) { const message = String(stderr || stdout || 'discovery failed').trim(); const optional = message.includes(\"the server doesn't have a resource type\") || message.includes('NotFound'); resolve({ error: optional ? null : resourceType + ': ' + message.slice(0, 4000), resources: [] }); return; }",
    "    try { const list = JSON.parse(stdout); resolve({ error: null, resources: (list.items || []).map((object) => ({ apiVersion: object.apiVersion, kind: object.kind, name: object.metadata.name, namespace: object.metadata.namespace || input.namespace })) }); } catch (error) { resolve({ error: resourceType + ': ' + error.message, resources: [] }); }",
    "  });",
    "});",
    "const worker = async () => { while (cursor < input.resourceTypes.length) { const index = cursor++; results[index] = await run(input.resourceTypes[index]); } };",
    "Promise.all(Array.from({ length: Math.min(input.concurrency, input.resourceTypes.length) }, worker)).then(() => { const discovered = results.flatMap((result) => result.resources); const errors = results.flatMap((result) => result.error ? [result.error] : []); if (discovered.length > input.maxResources) errors.push('targeted discovery exceeded the resource limit'); process.stdout.write(JSON.stringify({ errors, resources: discovered.slice(0, input.maxResources) })); }).catch((error) => { console.error(error.message); process.exit(1); });",
  ].join(" ");
  return `SEALAI_DISCOVERY_INPUT=${shellQuote(encoded)} node -e ${shellQuote(script)}`;
}

export function parseManagedResourceDiscovery(
  contents: string
): ManagedResourceDiscovery {
  return discoverySchema.parse(JSON.parse(contents));
}

export function buildManagedResourceObservationCommand(
  resources: readonly ManagedResourceRef[]
): string {
  const encoded = Buffer.from(
    JSON.stringify({
      batchTimeoutMs: RESOURCE_QUERY_BATCH_TIMEOUT_MS,
      concurrency: RESOURCE_QUERY_CONCURRENCY,
      refs: resources,
      requestTimeout: RESOURCE_QUERY_TIMEOUT,
    }),
    "utf8"
  ).toString("base64");
  const script = [
    'const { spawn } = require("node:child_process");',
    'const input = JSON.parse(Buffer.from(process.env.SEALAI_VERIFY_REFS, "base64").toString("utf8"));',
    "const observations = new Array(input.refs.length); const children = new Set(); let cursor = 0; let expired = false;",
    "const runKubectl = (args) => new Promise((resolve) => { const child = spawn('kubectl', [...args, '--request-timeout=' + input.requestTimeout], { stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child); let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; }); child.on('error', (error) => { children.delete(child); resolve({ code: 1, stderr: error.message, stdout: '' }); }); child.on('close', (code) => { children.delete(child); resolve({ code, stderr, stdout }); }); });",
    "const observe = async (resource) => {",
    "  const result = await runKubectl(['get', resource.kind, resource.name, '-n', resource.namespace, '-o', 'json']);",
    "  if (result.code !== 0) return { endpointsReady: null, error: String(result.stderr || result.stdout || 'resource observation failed').trim().slice(0, 4000), resource, snapshot: null };",
    "  try { const object = JSON.parse(result.stdout); const metadata = object.metadata || {}; const status = object.status || {}; const spec = object.spec || {}; let endpointsReady = null;",
    "    if (resource.kind.toLowerCase() === 'service') { const endpoints = await runKubectl(['get', 'endpoints', resource.name, '-n', resource.namespace, '-o', 'json']); if (endpoints.code === 0) { const value = JSON.parse(endpoints.stdout); endpointsReady = (value.subsets || []).reduce((count, subset) => count + (subset.addresses || []).length, 0); } else endpointsReady = 0; }",
    "    return { endpointsReady, error: null, resource, snapshot: { conditions: Array.isArray(status.conditions) ? status.conditions : [], generation: Number.isInteger(metadata.generation) ? metadata.generation : null, labels: metadata.labels || {}, ownerReferences: (metadata.ownerReferences || []).map((owner) => ({ kind: owner.kind, name: owner.name })), spec, status } };",
    "  } catch (error) { return { endpointsReady: null, error: error.message.slice(0, 4000), resource, snapshot: null }; }",
    "};",
    "const worker = async () => { while (!expired && cursor < input.refs.length) { const index = cursor++; observations[index] = await observe(input.refs[index]); } };",
    "const timeout = setTimeout(() => { expired = true; for (const child of children) child.kill('SIGTERM'); }, input.batchTimeoutMs);",
    "Promise.all(Array.from({ length: Math.min(input.concurrency, input.refs.length) }, worker)).then(() => { clearTimeout(timeout); for (let index = 0; index < input.refs.length; index += 1) if (!observations[index]) observations[index] = { endpointsReady: null, error: 'resource observation batch timed out', resource: input.refs[index], snapshot: null }; process.stdout.write(JSON.stringify(observations)); }).catch((error) => { clearTimeout(timeout); console.error(error.message); process.exit(1); });",
  ].join(" ");
  return `SEALAI_VERIFY_REFS=${shellQuote(encoded)} node -e ${shellQuote(script)}`;
}

export function parseManagedResourceObservations(
  contents: string
): ManagedResourceObservation[] {
  return observationsSchema.parse(JSON.parse(contents));
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
  if (kind === "pod") {
    return conditionTrue(snapshot.conditions, "Ready");
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

export interface ManagedBrainVerificationResult {
  ok: boolean;
  violations: string[];
}

/**
 * Thin Brain-side completion gate. The Agent supplies the resources it
 * actually created; Brain only re-reads those resources and requires at least
 * one reported runtime workload (or Pod) to be Ready. Deeper runtime truth,
 * logs, HTTP probes and repair decisions stay with the Agent.
 */
export function verifyManagedWorkloadReadiness(input: {
  observations: readonly ManagedResourceObservation[];
  workloads: readonly ManagedResourceRef[];
}): ManagedBrainVerificationResult {
  const violations: string[] = [];
  const observed = new Map(
    input.observations.map((observation) => [
      `${observation.resource.apiVersion}|${observation.resource.kind}|${observation.resource.namespace}|${observation.resource.name}`,
      observation,
    ])
  );

  for (const workload of input.workloads) {
    const key = `${workload.apiVersion}|${workload.kind}|${workload.namespace}|${workload.name}`;
    const observation = observed.get(key);
    if (observation == null || observation.error != null) {
      violations.push(
        `${workload.kind}/${workload.name} could not be observed`
      );
      continue;
    }
    if (observation.snapshot == null || !resourceReady(observation)) {
      violations.push(`${workload.kind}/${workload.name} is not ready`);
    }
  }

  const hasReadyRuntime = input.observations.some((observation) => {
    if (observation.error != null || observation.snapshot == null) {
      return false;
    }
    const kind = observation.resource.kind.toLowerCase();
    return (
      ["deployment", "statefulset", "daemonset", "job", "pod"].includes(kind) &&
      resourceReady(observation)
    );
  });
  if (!hasReadyRuntime) {
    violations.push("no reported runtime workload is Ready");
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Brain-owned gate for MCP completion notifications. This deliberately has no
 * Agent report argument: the notification only asks Brain to observe the
 * identity-labeled resources that already exist in the cluster.
 */
export function verifyManagedIdentityReadiness(input: {
  instanceName: string;
  observations: readonly ManagedResourceObservation[];
}): ManagedBrainVerificationResult {
  const violations: string[] = [];
  const instance = input.observations.find(
    (observation) =>
      observation.resource.kind.toLowerCase() === "instance" &&
      observation.resource.name === input.instanceName &&
      observation.error == null &&
      observation.snapshot != null
  );
  if (instance == null) {
    violations.push("allocated Instance was not observed");
  }
  if (
    !input.observations.some((observation) =>
      [
        "app",
        "cluster",
        "cronjob",
        "daemonset",
        "deployment",
        "job",
        "pod",
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
    if (!resourceReady(observation)) {
      violations.push(`${label} is not ready`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export function managedObservedResourceRefs(
  observations: readonly ManagedResourceObservation[]
): ManagedResourceRef[] {
  return observations.flatMap((observation) =>
    observation.error == null && observation.snapshot != null
      ? [observation.resource]
      : []
  );
}
