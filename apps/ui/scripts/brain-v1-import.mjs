#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

import {
  buildInventoryFromSnapshot,
  captureSnapshotWithKubeconfig,
  verifiedKubeconfigContents,
} from "./brain-v1-snapshot.mjs";

const { Client } = pg;

const PROJECT_DB_SCHEMA = "sealai_project";
const PROJECT_TABLE = `${PROJECT_DB_SCHEMA}.projects`;
const INVENTORY_SCHEMA = "brain-v1-inventory/v2";
const INVENTORY_VERSION = 2;
const MIGRATION_SCHEMA = "brain-v1-migration/v2";
const MIGRATION_VERSION = 2;
const DEFAULT_KUBECTL_RETRIES = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const BRAIN_LABELS = {
  deploymentKind: "brain.io/deployment-kind",
  deploymentName: "brain.io/deployment-name",
  managedBy: "brain.io/managed-by",
  projectId: "brain.io/project-id",
  templateName: "brain.io/template-name",
};

const LEGACY_LABELS = {
  appDeployManager: "cloud.sealos.io/app-deploy-manager",
  deployOnSealos: "cloud.sealos.io/deploy-on-sealos",
  displayName: "cloud.sealos.io/deploy-on-sealos-displayName",
};

const RESOURCE_TYPES = {
  app: "apps.app.sealos.io",
  certificate: "certificates.cert-manager.io",
  cluster: "clusters.apps.kubeblocks.io",
  configmap: "configmaps",
  deployment: "deployments",
  ingress: "ingresses",
  instance: "instances.app.sealos.io",
  issuer: "issuers.cert-manager.io",
  objectstoragebucket: "objectstoragebuckets.objectstorage.sealos.io",
  persistentvolumeclaim: "persistentvolumeclaims",
  secret: "secrets",
  service: "services",
  statefulset: "statefulsets",
};

function usage() {
  return `Brain v1 import helper

Usage:
  bun scripts/brain-v1-import.mjs snapshot --kubeconfig <path> --context <name> --out <dir> [--namespace <ns>] [--page-size <n>] [--request-timeout-ms <n>] [--retries <n>]
  bun scripts/brain-v1-import.mjs inventory --snapshot <dir> [--decisions <path>] [--out <dir>]
  bun scripts/brain-v1-import.mjs dry-run --inventory <path> [--out <dir>]
  bun scripts/brain-v1-import.mjs apply --manifest <path> [--database-url <url>] --yes
  bun scripts/brain-v1-import.mjs rollback --manifest <path> [--database-url <url>] --yes

Modes:
  snapshot  Read enumerated Kubernetes collection paths with in-process kubeconfig auth and write a resumable local snapshot.
  inventory Read only a completed local snapshot and write inventory.json + classification-report.json.
  dry-run   Read inventory.json and write migration.sql + migration-manifest.json. No DB/K8s writes.
  apply     Insert v2 project rows, then patch Kubernetes resources with brain.io/* labels.
  rollback  Delete inserted project rows and remove labels added by this migration.

Notes:
  - Omit --namespace from snapshot to scan all namespaces visible to the kubeconfig/context.
  - snapshot writes snapshot-v1/snapshot-manifest.json and normalized NDJSON resource files.
  - inventory rejects kubeconfig/context flags and never contacts Kubernetes.
  - --retries defaults to ${DEFAULT_KUBECTL_RETRIES} for transient Kubernetes GET errors.
  - DATABASE_URL is used when --database-url is omitted.
  - apply/rollback require --yes or BRAIN_V1_IMPORT_YES=1.
`;
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith("--")) {
      options._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (key === "yes" || key === "help") {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    i += 1;
  }
  return { mode, options };
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function integerOption(value, name, fallback, minimum) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function sqlString(value) {
  if (value == null) {
    return "null";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function resourceName(resource) {
  return resource.metadata?.name ?? "";
}

function resourceNamespace(resource, fallback) {
  return resource.metadata?.namespace ?? fallback;
}

function kubectlBaseArgs(options) {
  const args = [];
  if (options.kubeconfigContents) {
    args.push("--kubeconfig", "/dev/stdin");
  } else if (options.kubeconfig) {
    args.push("--kubeconfig", options.kubeconfig);
  }
  if (options.context) {
    args.push("--context", options.context);
  }
  return args;
}

function kubectlRetryCount(options) {
  const raw = options.retries ?? process.env.BRAIN_V1_IMPORT_RETRIES;
  if (raw === undefined) {
    return DEFAULT_KUBECTL_RETRIES;
  }
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("--retries must be a non-negative integer");
  }
  return value;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errorText(error) {
  return [
    error instanceof Error ? error.message : String(error),
    error?.stderr?.toString?.() ?? "",
    error?.stdout?.toString?.() ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isTransientKubectlError(error) {
  const text = errorText(error).toLowerCase();
  return [
    "tls handshake timeout",
    "i/o timeout",
    "connection reset",
    "connection refused",
    "temporary failure",
    "timeout awaiting headers",
    "context deadline exceeded",
    "net/http: request canceled",
    "unexpected eof",
    "eof",
  ].some((pattern) => text.includes(pattern));
}

function runKubectl(options, args, input) {
  const retries = kubectlRetryCount(options);
  const commandInput = options.kubeconfigContents ?? input;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return execFileSync("kubectl", [...kubectlBaseArgs(options), ...args], {
        encoding: "utf8",
        input: commandInput,
        maxBuffer: 100 * 1024 * 1024,
        stdio:
          commandInput === undefined
            ? ["ignore", "pipe", "pipe"]
            : ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientKubectlError(error)) {
        throw error;
      }
      sleepMs(Math.min(1000 * 2 ** attempt, 5000));
    }
  }
  throw lastError;
}

function patchResourceLabels(options, patch) {
  const payload = JSON.stringify({ metadata: { labels: patch.addedLabels } });
  runKubectl(options, [
    "patch",
    patch.resource.type,
    patch.resource.name,
    "-n",
    patch.resource.namespace,
    "--type",
    "merge",
    "-p",
    payload,
  ]);
}

function removeResourceLabels(options, patch) {
  const labels = Object.fromEntries(
    Object.keys(patch.addedLabels).map((key) => [key, null])
  );
  const payload = JSON.stringify({ metadata: { labels } });
  runKubectl(options, [
    "patch",
    patch.resource.type,
    patch.resource.name,
    "-n",
    patch.resource.namespace,
    "--type",
    "merge",
    "-p",
    payload,
  ]);
}

function resourceRef(resource, type, namespace) {
  return {
    apiVersion: resource.apiVersion ?? "",
    creationTimestamp: resource.metadata?.creationTimestamp ?? "",
    kind: resource.kind ?? "",
    name: resourceName(resource),
    namespace: resourceNamespace(resource, namespace),
    type,
    uid: resource.metadata?.uid ?? "",
  };
}

function brainLabels(projectId, deploymentKind, deploymentName) {
  return {
    [BRAIN_LABELS.managedBy]: "brain",
    [BRAIN_LABELS.projectId]: projectId,
    [BRAIN_LABELS.deploymentKind]: deploymentKind,
    [BRAIN_LABELS.deploymentName]: deploymentName,
  };
}

function dedupePatches(patches) {
  const seen = new Set();
  const out = [];
  for (const patch of patches) {
    const key = `${patch.resource.type}\0${patch.resource.namespace}\0${patch.resource.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(patch);
  }
  return out;
}

function projectInsertSql(project) {
  return `insert into ${PROJECT_TABLE} (namespace, id, display_name, description, created_at, updated_at)
values (${sqlString(project.namespace)}, ${sqlString(project.id)}, ${sqlString(project.displayName)}, ${sqlString(project.description)}, ${sqlString(project.createdAt)}, now())
on conflict (namespace, id) do nothing;`;
}

function buildManifestFromInventory(inventory) {
  requireCompleteInventory(inventory);
  const ignoredProjects = [];
  const importableProjects = [];
  for (const entry of inventory.projects) {
    if (isAppOnlyInventoryProject(entry)) {
      ignoredProjects.push({
        displayName: entry.displayName,
        legacyInstance: entry.legacyInstance.resource,
        reason: "app-crd-only",
      });
      continue;
    }
    importableProjects.push(entry);
  }
  const displayNamePlan = resolveProjectDisplayNames(importableProjects);
  const projects = importableProjects.map((entry) => {
    const displayName = displayNamePlan.displayNames.get(
      inventoryProjectKey(entry)
    );
    if (displayName === undefined) {
      throw new Error(
        `Missing display name for ${entry.legacyInstance.resource.namespace}/${entry.legacyInstance.resource.name}`
      );
    }
    const entryNamespace = entry.legacyInstance.resource.namespace;
    const instance = {
      apiVersion: entry.legacyInstance.resource.apiVersion,
      kind: entry.legacyInstance.resource.kind,
      metadata: {
        labels: entry.legacyInstance.labels,
        name: entry.legacyInstance.resource.name,
        namespace: entry.legacyInstance.resource.namespace,
        uid: entry.legacyInstance.resource.uid,
      },
    };
    const project = {
      createdAt:
        entry.legacyInstance.resource.creationTimestamp ||
        inventory.generatedAt,
      description: `Imported from Brain v1 Instance ${entry.legacyInstance.resource.name}`,
      displayName: displayName.value,
      id: entry.projectId,
      namespace: entryNamespace,
      ...(displayName.original === displayName.value
        ? {}
        : { originalDisplayName: displayName.original }),
    };
    const memberPatches = entry.members.flatMap((member) =>
      patchesFromInventoryMember(member, entry, entryNamespace)
    );
    const supportPatches = entry.supportResources.flatMap((support) =>
      patchesFromInventorySupport(support, entry)
    );
    const result = classifyInventoryProject(entry);
    return {
      classifications: result.classifications,
      insertSql: projectInsertSql(project),
      legacyInstance: resourceRef(
        instance,
        RESOURCE_TYPES.instance,
        entryNamespace
      ),
      patches: dedupePatches([
        ...result.instancePatches,
        ...memberPatches,
        ...supportPatches,
      ]),
      project,
      skipped: result.skipped,
    };
  });

  return {
    context: inventory.context ?? null,
    generatedAt: new Date().toISOString(),
    inventoryGeneratedAt: inventory.generatedAt,
    kubeconfig: inventory.kubeconfig ?? null,
    mode: "dry-run",
    namespace: inventory.namespace,
    displayNameAdjustments: displayNamePlan.adjustments,
    scope: inventory.scope ?? (inventory.namespace ? "namespace" : "cluster"),
    schema: MIGRATION_SCHEMA,
    projects,
    skippedInstances: inventory.skippedInstances,
    skippedProjects: ignoredProjects,
    sourceFingerprint: inventory.sourceFingerprint,
    summary: {
      candidateProjects: projects.length,
      patches: projects.reduce(
        (sum, project) => sum + project.patches.length,
        0
      ),
      skippedInstances: inventory.skippedInstances.length,
      displayNameAdjustments: displayNamePlan.adjustments.length,
      skippedProjects: ignoredProjects.length,
      skippedResources: projects.reduce(
        (sum, project) => sum + project.skipped.length,
        0
      ),
      totalInstances:
        inventory.projects.length + inventory.skippedInstances.length,
    },
    version: MIGRATION_VERSION,
  };
}

function isAppOnlyInventoryProject(entry) {
  return (
    entry.members.length === 1 &&
    entry.members[0]?.resource.kind === "App" &&
    entry.supportResources.length === 0
  );
}

function inventoryProjectKey(entry) {
  const resource = entry.legacyInstance.resource;
  return `${resource.namespace}\0${resource.name}\0${resource.uid}`;
}

function normalizeProjectDisplayName(entry) {
  const instanceName = entry.legacyInstance.resource.name;
  const displayName = String(entry.displayName ?? "").trim();
  return displayName === "" ? instanceName : displayName;
}

function resolveProjectDisplayNames(entries) {
  const usedByNamespace = new Map();
  const displayNames = new Map();
  const adjustments = [];

  for (const entry of entries) {
    const namespace = entry.legacyInstance.resource.namespace;
    const original = normalizeProjectDisplayName(entry);
    let used = usedByNamespace.get(namespace);
    if (used === undefined) {
      used = new Set();
      usedByNamespace.set(namespace, used);
    }

    const value = nextUniqueProjectDisplayName(original, entry, used);
    used.add(value);
    displayNames.set(inventoryProjectKey(entry), { original, value });

    if (value !== original) {
      adjustments.push({
        displayName: value,
        legacyInstance: entry.legacyInstance.resource,
        originalDisplayName: original,
        reason: "namespace-display-name-conflict",
      });
    }
  }

  return { adjustments, displayNames };
}

function nextUniqueProjectDisplayName(displayName, entry, used) {
  if (!used.has(displayName)) {
    return displayName;
  }

  const instanceName = entry.legacyInstance.resource.name;
  const candidateBase = `${displayName} (${instanceName})`;
  if (!used.has(candidateBase)) {
    return candidateBase;
  }

  const shortProjectId = entry.projectId.slice(0, 8);
  let candidate = `${candidateBase} ${shortProjectId}`;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${candidateBase} ${shortProjectId}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function classifyInventoryProject(entry) {
  const labels = brainLabels(
    entry.projectId,
    "template",
    entry.legacyInstance.resource.name
  );
  const classifications = [
    {
      deploymentKind: "template",
      name: entry.legacyInstance.resource.name,
      resource: entry.legacyInstance.resource,
    },
  ];
  const instancePatches = [
    {
      addedLabels: labels,
      originalLabels: entry.legacyInstance.labels,
      reason: "template-instance",
      resource: entry.legacyInstance.resource,
    },
  ];
  const skipped = [];
  for (const member of entry.members) {
    if (member.resource.type === RESOURCE_TYPES.objectstoragebucket) {
      skipped.push({
        reason: "requires-manual-review",
        resource: member.resource,
      });
      continue;
    }
    const isApWorkload =
      (member.resource.kind === "Deployment" ||
        member.resource.kind === "StatefulSet") &&
      typeof member.labels[LEGACY_LABELS.appDeployManager] === "string" &&
      member.labels[LEGACY_LABELS.appDeployManager] !== "";
    if (
      !isApWorkload &&
      member.resource.kind !== "App" &&
      member.resource.kind !== "Cluster"
    ) {
      skipped.push({
        reason: "not-migrated-unsupported-member",
        resource: member.resource,
      });
    }
  }
  return { classifications, instancePatches, skipped };
}

function patchesFromInventoryMember(member, entry, namespace) {
  if (
    member.resource.kind === "Deployment" ||
    member.resource.kind === "StatefulSet"
  ) {
    const appName = member.labels[LEGACY_LABELS.appDeployManager];
    if (typeof appName === "string" && appName !== "") {
      return [
        {
          addedLabels: brainLabels(entry.projectId, "ap", appName),
          originalLabels: member.labels,
          reason: "ap-workload",
          resource: member.resource,
        },
      ];
    }
  }
  if (member.resource.kind === "App") {
    return [
      {
        addedLabels: brainLabels(
          entry.projectId,
          "template",
          entry.legacyInstance.resource.name
        ),
        originalLabels: member.labels,
        reason: "template-app",
        resource: member.resource,
      },
    ];
  }
  if (member.resource.kind === "Cluster") {
    return [
      {
        addedLabels: brainLabels(entry.projectId, "db", member.resource.name),
        originalLabels: member.labels,
        reason: "db-cluster",
        resource: member.resource,
      },
    ];
  }
  if (member.resource.namespace !== namespace) {
    return [];
  }
  return [];
}

function patchesFromInventorySupport(support, entry) {
  const appName = support.labels[LEGACY_LABELS.appDeployManager];
  if (typeof appName !== "string" || appName === "") {
    return [];
  }
  return [
    {
      addedLabels: brainLabels(entry.projectId, "ap", appName),
      originalLabels: support.labels,
      reason: "ap-support-resource",
      resource: support.resource,
    },
  ];
}

function writeDryRunOutputs(manifest, outDir) {
  mkdirSync(outDir, { recursive: true });
  const sql = [
    "-- Brain v1 -> v2 project import",
    `-- Generated at: ${manifest.generatedAt}`,
    `-- Scope: ${manifest.scope ?? "namespace"}`,
    `-- Namespace: ${manifest.namespace ?? "all-namespaces"}`,
    "begin;",
    ...manifest.projects.map((project) => project.insertSql),
    "commit;",
    "",
  ].join("\n");
  const manifestPath = path.join(outDir, "migration-manifest.json");
  const sqlPath = path.join(outDir, "migration.sql");
  writeFileSync(sqlPath, sql, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, sqlPath };
}

function loadInventory(inventoryPath) {
  if (!existsSync(inventoryPath)) {
    throw new Error(`Inventory not found: ${inventoryPath}`);
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (
    inventory.version !== INVENTORY_VERSION ||
    inventory.schema !== INVENTORY_SCHEMA ||
    inventory.source !== "snapshot-v1" ||
    !SHA256_PATTERN.test(inventory.sourceFingerprint ?? "")
  ) {
    throw new Error(
      `Unsupported inventory schema/version: ${inventory.schema ?? "legacy"}/${inventory.version}; expected ${INVENTORY_SCHEMA}/${INVENTORY_VERSION}`
    );
  }
  return inventory;
}

function requireCompleteInventory(inventory) {
  const errors = inventory.errors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `Inventory has ${errors.length} unresolved error(s). Re-run inventory until errors is empty before dry-run.`
    );
  }
  const manualReviewProjects = inventory.manualReviewProjects ?? [];
  if (
    manualReviewProjects.length > 0 ||
    inventory.classification?.complete !== true ||
    inventory.classification?.unresolvedCount !== 0
  ) {
    throw new Error(
      "Inventory has unresolved classification decisions. Resolve classification-report.json before dry-run."
    );
  }
}

function validateManifestPatch(patch) {
  const allowedLabelKeys = new Set(Object.values(BRAIN_LABELS));
  const allowedResourceTypes = new Set(Object.values(RESOURCE_TYPES));
  const resource = patch?.resource;
  const labels = patch?.addedLabels;
  if (
    !resource ||
    typeof resource.name !== "string" ||
    resource.name === "" ||
    typeof resource.namespace !== "string" ||
    resource.namespace === "" ||
    !allowedResourceTypes.has(resource.type) ||
    !labels ||
    Object.keys(labels).length === 0 ||
    !Object.entries(labels).every(
      ([key, value]) => allowedLabelKeys.has(key) && typeof value === "string"
    )
  ) {
    throw new Error("Unsafe or malformed migration manifest patch");
  }
}

function validateManifestShape(manifest) {
  if (manifest.mode !== "dry-run" || !Array.isArray(manifest.projects)) {
    throw new Error("Malformed migration manifest");
  }
  for (const entry of manifest.projects) {
    if (
      typeof entry?.project?.namespace !== "string" ||
      entry.project.namespace === "" ||
      !UUID_PATTERN.test(entry.project.id) ||
      !Array.isArray(entry.patches)
    ) {
      throw new Error("Malformed migration manifest project");
    }
    for (const patch of entry.patches) {
      validateManifestPatch(patch);
    }
  }
}

function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const isCurrent =
    manifest.version === MIGRATION_VERSION &&
    manifest.schema === MIGRATION_SCHEMA;
  if (!isCurrent) {
    throw new Error(
      `Unsupported manifest schema/version: ${manifest.schema ?? "legacy"}/${manifest.version}; expected ${MIGRATION_SCHEMA}/${MIGRATION_VERSION}`
    );
  }
  if (isCurrent && !SHA256_PATTERN.test(manifest.sourceFingerprint ?? "")) {
    throw new Error("Malformed migration manifest source fingerprint");
  }
  validateManifestShape(manifest);
  return manifest;
}

function withVerifiedManifestSource(manifest, callback) {
  const kubeconfig = required(manifest.kubeconfig, "manifest kubeconfig");
  const context = required(manifest.context, "manifest context");
  const contents = verifiedKubeconfigContents(
    kubeconfig,
    context,
    manifest.sourceFingerprint
  );
  return callback({ context, kubeconfigContents: contents });
}

async function withDb(databaseUrl, callback) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await callback(client);
  } finally {
    await client.end();
  }
}

async function insertProjects(databaseUrl, manifest) {
  await withDb(databaseUrl, async (client) => {
    await client.query("begin");
    try {
      for (const entry of manifest.projects) {
        const project = entry.project;
        await client.query(
          `insert into ${PROJECT_TABLE} (namespace, id, display_name, description, created_at, updated_at)
values ($1, $2, $3, $4, $5, now())
on conflict (namespace, id) do nothing`,
          [
            project.namespace,
            project.id,
            project.displayName,
            project.description,
            project.createdAt,
          ]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

async function deleteProjects(databaseUrl, manifest) {
  await withDb(databaseUrl, async (client) => {
    await client.query("begin");
    try {
      for (const project of manifest.projects) {
        await client.query(
          `delete from ${PROJECT_TABLE} where namespace = $1 and id = $2`,
          [project.project.namespace, project.project.id]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

function requireConfirmation(options) {
  if (options.yes === true || process.env.BRAIN_V1_IMPORT_YES === "1") {
    return;
  }
  throw new Error("apply/rollback requires --yes or BRAIN_V1_IMPORT_YES=1");
}

function dryRun(options) {
  const inventoryPath = required(options.inventory, "--inventory");
  const inventoryValue = loadInventory(inventoryPath);
  const scopeName = inventoryValue.namespace ?? "all-namespaces";
  const outDir =
    options.out ??
    path.join(
      ".migration",
      `brain-v1-${sanitizeFilePart(scopeName)}-${Date.now()}`
    );
  const manifest = buildManifestFromInventory(inventoryValue);
  const outputs = writeDryRunOutputs(manifest, outDir);
  console.log(JSON.stringify({ outputs, summary: manifest.summary }, null, 2));
}

async function snapshot(options) {
  const kubeconfig = required(options.kubeconfig, "--kubeconfig");
  const context = required(options.context, "--context");
  const outDir = required(options.out, "--out");
  const result = await captureSnapshotWithKubeconfig({
    context,
    kubeconfig,
    namespace: options.namespace,
    outDir,
    pageSize: integerOption(options["page-size"], "--page-size", 200, 1),
    requestTimeoutMs: integerOption(
      options["request-timeout-ms"],
      "--request-timeout-ms",
      60_000,
      1000
    ),
    retries: integerOption(
      options.retries,
      "--retries",
      DEFAULT_KUBECTL_RETRIES,
      0
    ),
  });
  console.log(
    JSON.stringify(
      {
        manifest: result.manifestPath,
        snapshot: result.snapshotDir,
        summary: {
          resources: result.manifest.resources.length,
          totalRecords: result.manifest.resources.reduce(
            (sum, resource) => sum + (resource.count ?? 0),
            0
          ),
        },
      },
      null,
      2
    )
  );
}

async function inventory(options) {
  if (options.kubeconfig || options.context || options.namespace) {
    throw new Error(
      "inventory is local-only; use snapshot for Kubernetes access and pass --snapshot"
    );
  }
  const snapshotDir = required(options.snapshot, "--snapshot");
  const outDir = options.out ?? path.dirname(snapshotDir);
  const result = await buildInventoryFromSnapshot({
    decisionsPath: options.decisions,
    outDir,
    snapshotDir,
  });
  console.log(
    JSON.stringify(
      {
        outputs: {
          classificationReport: result.reportPath,
          inventory: result.inventoryPath,
          snapshotIndex: result.indexPath,
        },
        summary: result.report.summary,
      },
      null,
      2
    )
  );
}

async function apply(options) {
  requireConfirmation(options);
  const manifest = loadManifest(required(options.manifest, "--manifest"));
  const databaseUrl = options["database-url"] ?? process.env.DATABASE_URL ?? "";
  required(databaseUrl, "--database-url or DATABASE_URL");
  await withVerifiedManifestSource(manifest, async (kubeOptions) => {
    await insertProjects(databaseUrl, manifest);
    for (const project of manifest.projects) {
      for (const patch of project.patches) {
        patchResourceLabels(kubeOptions, patch);
        console.log(
          `patched ${patch.resource.type}/${patch.resource.name} ${patch.resource.namespace}`
        );
      }
    }
  });
  console.log("apply complete");
}

async function rollback(options) {
  requireConfirmation(options);
  const manifest = loadManifest(required(options.manifest, "--manifest"));
  const databaseUrl = options["database-url"] ?? process.env.DATABASE_URL ?? "";
  required(databaseUrl, "--database-url or DATABASE_URL");
  await withVerifiedManifestSource(manifest, async (kubeOptions) => {
    for (const project of [...manifest.projects].reverse()) {
      for (const patch of [...project.patches].reverse()) {
        removeResourceLabels(kubeOptions, patch);
        console.log(
          `removed labels from ${patch.resource.type}/${patch.resource.name} ${patch.resource.namespace}`
        );
      }
    }
    await deleteProjects(databaseUrl, manifest);
  });
  console.log("rollback complete");
}

export async function main(argv = process.argv.slice(2)) {
  const { mode, options } = parseArgs(argv);
  if (!mode || mode === "help" || options.help) {
    console.log(usage());
    return;
  }
  if (mode === "dry-run") {
    dryRun(options);
    return;
  }
  if (mode === "snapshot") {
    await snapshot(options);
    return;
  }
  if (mode === "inventory") {
    await inventory(options);
    return;
  }
  if (mode === "apply") {
    await apply(options);
    return;
  }
  if (mode === "rollback") {
    await rollback(options);
    return;
  }
  throw new Error(`Unknown mode: ${mode}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
