import { Buffer } from "node:buffer";
import { z } from "zod";

import {
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_PROJECT_ID_LABEL,
} from "@/lib/brain-labels";

import type {
  ManagedResourceRef,
  ManagedTurnReport,
} from "./managed-deployment-contract";

const SEED_INVENTORY_KINDS = [
  "apps.app.sealos.io",
  "certificates.cert-manager.io",
  "configmaps",
  "clusters.apps.kubeblocks.io",
  "controllerrevisions.apps",
  "cronjobs.batch",
  "daemonsets.apps",
  "deployments.apps",
  "endpoints",
  "endpointslices.discovery.k8s.io",
  "horizontalpodautoscalers.autoscaling",
  "ingresses.networking.k8s.io",
  "instances.app.sealos.io",
  "issuers.cert-manager.io",
  "jobs.batch",
  "limitranges",
  "networkpolicies.networking.k8s.io",
  "objectstoragebuckets.objectstorage.sealos.io",
  "persistentvolumeclaims",
  "pods",
  "poddisruptionbudgets.policy",
  "replicasets.apps",
  "resourcequotas",
  "rolebindings.rbac.authorization.k8s.io",
  "roles.rbac.authorization.k8s.io",
  "secrets",
  "serviceaccounts",
  "services",
  "statefulsets.apps",
] as const;

const DISCOVERY_MUTATION_VERBS = [
  "create",
  "delete",
  "patch",
  "update",
] as const;
const DISCOVERY_EXCLUDED_KINDS = [
  "events",
  "events.events.k8s.io",
  "leases.coordination.k8s.io",
] as const;
const MAX_INVENTORY_ERRORS = 1024;
const MAX_INVENTORY_ITEMS = 20_000;
const MAX_INVENTORY_KINDS = 512;

const inventoryItemSchema = z
  .object({
    apiVersion: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().nonnegative().nullable(),
    kind: z.string().min(1),
    labels: z.record(z.string(), z.string()),
    managers: z.array(z.string().min(1).max(128)).max(128),
    name: z.string().min(1),
    namespace: z.string().min(1),
    ownerReferences: z.array(
      z
        .object({
          kind: z.string().min(1),
          name: z.string().min(1),
          uid: z.string().min(1).nullable(),
        })
        .strict()
    ),
    uid: z.string().min(1).nullable(),
  })
  .strict();

const inventorySchema = z
  .object({
    errors: z.array(z.string().max(2000)).max(MAX_INVENTORY_ERRORS),
    items: z.array(inventoryItemSchema).max(MAX_INVENTORY_ITEMS),
  })
  .strict();

export type ManagedResourceInventoryItem = z.infer<typeof inventoryItemSchema>;
export type ManagedResourceInventory = z.infer<typeof inventorySchema>;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildManagedInventoryCommand(namespace: string): string {
  const encoded = Buffer.from(
    JSON.stringify({
      excludedKinds: DISCOVERY_EXCLUDED_KINDS,
      maxKinds: MAX_INVENTORY_KINDS,
      mutationVerbs: DISCOVERY_MUTATION_VERBS,
      namespace,
      seedKinds: SEED_INVENTORY_KINDS,
    }),
    "utf8"
  ).toString("base64");
  const script = [
    'const { createHash } = require("node:crypto");',
    'const { spawnSync } = require("node:child_process");',
    'const input = JSON.parse(Buffer.from(process.env.SEALAI_INVENTORY_INPUT, "base64").toString("utf8"));',
    "const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;",
    "const items = []; const errors = []; const excluded = new Set(input.excludedKinds); const discovered = new Set(input.seedKinds);",
    "for (const verb of input.mutationVerbs) {",
    "  const discovery = spawnSync('kubectl', ['api-resources', '--namespaced=true', '--verbs=list,' + verb, '-o', 'name'], { encoding: 'utf8' });",
    "  if (discovery.status !== 0) { errors.push(('api discovery (' + verb + '): ' + String(discovery.stderr || discovery.stdout || '')).trim().slice(0, 2000)); continue; }",
    "  for (const resourceType of discovery.stdout.split(/\\s+/).filter(Boolean)) if (!excluded.has(resourceType)) discovered.add(resourceType);",
    "}",
    "const kinds = [...discovered].filter((kind) => !excluded.has(kind)).sort();",
    "if (kinds.length > input.maxKinds) errors.push('api discovery exceeded the managed inventory kind limit');",
    "for (const resourceType of kinds.slice(0, input.maxKinds)) {",
    "  const result = spawnSync('kubectl', ['get', resourceType, '-n', input.namespace, '-o', 'json'], { encoding: 'utf8' });",
    "  if (result.status !== 0) {",
    "    const message = String(result.stderr || result.stdout || '').trim();",
    "    if (!message.includes(\"the server doesn't have a resource type\")) errors.push((resourceType + ': ' + message).slice(0, 2000));",
    "    continue;",
    "  }",
    "  const list = JSON.parse(result.stdout);",
    "  for (const object of list.items || []) {",
    "    const metadata = object.metadata || {};",
    "    const desired = { ...object, metadata: { annotations: metadata.annotations || {}, labels: metadata.labels || {}, name: metadata.name, namespace: metadata.namespace, ownerReferences: metadata.ownerReferences || [] } };",
    "    delete desired.status;",
    "    const digest = createHash('sha256').update(JSON.stringify(stable(desired))).digest('hex');",
    "    items.push({ apiVersion: object.apiVersion, digest, generation: Number.isInteger(metadata.generation) ? metadata.generation : null, kind: object.kind, labels: metadata.labels || {}, managers: [...new Set((metadata.managedFields || []).map((entry) => entry.manager).filter((manager) => typeof manager === 'string' && manager.length > 0))], name: metadata.name, namespace: metadata.namespace || input.namespace, ownerReferences: (metadata.ownerReferences || []).map((owner) => ({ kind: owner.kind, name: owner.name, uid: owner.uid || null })), uid: metadata.uid || null });",
    "  }",
    "}",
    "process.stdout.write(JSON.stringify({ errors, items }));",
  ].join(" ");
  return `SEALAI_INVENTORY_INPUT=${shellQuote(encoded)} node -e ${shellQuote(script)}`;
}

export function parseManagedResourceInventory(
  contents: string
): ManagedResourceInventory {
  return inventorySchema.parse(JSON.parse(contents));
}

function resourceKey(resource: {
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

function isDirectIdentityResource(
  resource: ManagedResourceInventoryItem,
  instanceName: string,
  projectId: string
): boolean {
  return (
    resource.labels[BRAIN_PROJECT_ID_LABEL] === projectId &&
    ((resource.kind === "Instance" && resource.name === instanceName) ||
      resource.labels[BRAIN_DEPLOYMENT_NAME_LABEL] === instanceName)
  );
}

function ownerKey(resource: {
  kind: string;
  name: string;
  namespace: string;
  uid: string;
}) {
  return [resource.kind, resource.namespace, resource.name, resource.uid].join(
    "|"
  );
}

function identityResourceKeys(input: {
  instanceName: string;
  inventory: ManagedResourceInventory;
  projectId: string;
}): Set<string> {
  const identityKeys = new Set<string>();
  const identityOwners = new Set<string>();
  for (const resource of input.inventory.items) {
    if (
      isDirectIdentityResource(resource, input.instanceName, input.projectId)
    ) {
      identityKeys.add(resourceKey(resource));
      if (resource.uid != null) {
        identityOwners.add(ownerKey({ ...resource, uid: resource.uid }));
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const resource of input.inventory.items) {
      const key = resourceKey(resource);
      if (
        identityKeys.has(key) ||
        !resource.ownerReferences.some((owner) =>
          owner.uid == null
            ? false
            : identityOwners.has(
                ownerKey({
                  kind: owner.kind,
                  name: owner.name,
                  namespace: resource.namespace,
                  uid: owner.uid,
                })
              )
        )
      ) {
        continue;
      }
      identityKeys.add(key);
      if (resource.uid != null) {
        identityOwners.add(ownerKey({ ...resource, uid: resource.uid }));
      }
      changed = true;
    }
  }
  return identityKeys;
}

export function managedIdentityResourceRefs(input: {
  instanceName: string;
  inventory: ManagedResourceInventory;
  projectId: string;
}): ManagedResourceRef[] {
  const identityKeys = identityResourceKeys(input);
  return input.inventory.items
    .filter((resource) => identityKeys.has(resourceKey(resource)))
    .map((resource) => ({
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      name: resource.name,
      namespace: resource.namespace,
      ...(resource.uid == null ? {} : { uid: resource.uid }),
    }));
}

export interface ManagedMutationAuditResult {
  changedResourceKeys: string[];
  ok: boolean;
  violations: string[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The audit evaluates each mutation invariant in one deterministic pass.
export function auditManagedDeploymentMutations(input: {
  after: ManagedResourceInventory;
  before: ManagedResourceInventory;
  fieldManager: string;
  instanceName: string;
  projectId: string;
  report: ManagedTurnReport;
}): ManagedMutationAuditResult {
  const violations = [
    ...input.before.errors.map((error) => `pre-inventory: ${error}`),
    ...input.after.errors.map((error) => `post-inventory: ${error}`),
  ];
  const before = new Map(
    input.before.items.map((item) => [resourceKey(item), item])
  );
  const after = new Map(
    input.after.items.map((item) => [resourceKey(item), item])
  );
  const declared = new Map(
    input.report.mutations
      .filter((mutation) => mutation.operation !== "exec")
      .map((mutation) => [resourceKey(mutation.resource), mutation])
  );
  const beforeIdentityKeys = identityResourceKeys({
    instanceName: input.instanceName,
    inventory: input.before,
    projectId: input.projectId,
  });
  const afterIdentityKeys = identityResourceKeys({
    instanceName: input.instanceName,
    inventory: input.after,
    projectId: input.projectId,
  });
  const changedResourceKeys = [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key)?.digest !== after.get(key)?.digest)
    .sort();

  for (const mutation of input.report.mutations) {
    if (mutation.operation !== "exec") {
      continue;
    }
    const key = resourceKey(mutation.resource);
    if (!(beforeIdentityKeys.has(key) || afterIdentityKeys.has(key))) {
      violations.push(`exec outside identity envelope: ${key}`);
    }
  }

  for (const key of changedResourceKeys) {
    const mutation = declared.get(key);
    const current = after.get(key);
    const previous = before.get(key);
    if (current != null && previous != null && current.uid !== previous.uid) {
      violations.push(`resource UID changed during turn: ${key}`);
    }
    if (mutation == null) {
      const controllerResource = current ?? previous;
      const isIdentityChild =
        controllerResource != null &&
        controllerResource.ownerReferences.length > 0 &&
        (beforeIdentityKeys.has(key) || afterIdentityKeys.has(key));
      if (
        isIdentityChild &&
        !controllerResource.managers.includes(input.fieldManager)
      ) {
        continue;
      }
      violations.push(`undeclared mutation: ${key}`);
      continue;
    }
    // Existing resources must belong to the task before mutation. Otherwise an
    // Agent could claim an unrelated resource by adding the identity label.
    const belongsBeforeMutation =
      previous == null
        ? afterIdentityKeys.has(key)
        : beforeIdentityKeys.has(key);
    if (!belongsBeforeMutation) {
      violations.push(`mutation outside identity envelope: ${key}`);
    }
    if (current == null) {
      if (mutation.operation !== "delete") {
        violations.push(`undeclared delete operation: ${key}`);
      } else if (mutation.preconditionUid !== previous?.uid) {
        violations.push(`delete UID precondition mismatch: ${key}`);
      }
    } else if (mutation.operation === "delete") {
      violations.push(`delete operation did not delete resource: ${key}`);
    } else if (
      mutation.fieldManager != null &&
      !current.managers.includes(mutation.fieldManager)
    ) {
      violations.push(`field manager did not own mutation: ${key}`);
    }
  }

  for (const [key, mutation] of declared) {
    if (!(before.has(key) || after.has(key))) {
      violations.push(`declared mutation was not observable: ${key}`);
    }
    if (mutation.operation === "create" && before.has(key) && after.has(key)) {
      violations.push(`create operation targeted an existing resource: ${key}`);
    }
  }

  return {
    changedResourceKeys,
    ok: violations.length === 0,
    violations,
  };
}
