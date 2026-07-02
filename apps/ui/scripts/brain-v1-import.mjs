#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const PROJECT_DB_SCHEMA = "sealai_project";
const PROJECT_TABLE = `${PROJECT_DB_SCHEMA}.projects`;
const MIGRATION_VERSION = 1;

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

const PROJECT_MEMBER_RESOURCE_TYPES = [
  RESOURCE_TYPES.deployment,
  RESOURCE_TYPES.statefulset,
  RESOURCE_TYPES.configmap,
  RESOURCE_TYPES.app,
  RESOURCE_TYPES.cluster,
  RESOURCE_TYPES.objectstoragebucket,
];

const AP_SUPPORT_RESOURCE_TYPES = [
  RESOURCE_TYPES.service,
  RESOURCE_TYPES.ingress,
  RESOURCE_TYPES.configmap,
  RESOURCE_TYPES.persistentvolumeclaim,
  RESOURCE_TYPES.secret,
  RESOURCE_TYPES.issuer,
  RESOURCE_TYPES.certificate,
];

function usage() {
  return `Brain v1 import helper

Usage:
  bun scripts/brain-v1-import.mjs inventory --namespace <ns> [--kubeconfig <path>] [--context <name>] [--out <dir>]
  bun scripts/brain-v1-import.mjs dry-run --namespace <ns> [--kubeconfig <path>] [--context <name>] [--out <dir>]
  bun scripts/brain-v1-import.mjs dry-run --inventory <path> [--out <dir>]
  bun scripts/brain-v1-import.mjs apply --manifest <path> [--database-url <url>] --yes
  bun scripts/brain-v1-import.mjs rollback --manifest <path> [--database-url <url>] --yes

Modes:
  inventory Read Kubernetes and write inventory.json. No SQL, DB, or K8s writes.
  dry-run   Read Kubernetes and write migration.sql + migration-manifest.json. No DB/K8s writes.
  apply     Insert v2 project rows, then patch Kubernetes resources with brain.io/* labels.
  rollback  Delete inserted project rows and remove labels added by this migration.

Notes:
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

function sqlString(value) {
  if (value == null) {
    return "null";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function deterministicProjectId(namespace, instance) {
  const source = `${namespace}\0${instance.metadata?.uid ?? instance.metadata?.name ?? ""}`;
  const hex = createHash("sha256")
    .update(`brain-v1-import\0${source}`)
    .digest("hex");
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = String((Number.parseInt(chars[16], 16) % 4) + 8);
  const id = chars.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function labelsOf(resource) {
  return resource.metadata?.labels ?? {};
}

function annotationsOf(resource) {
  return resource.metadata?.annotations ?? {};
}

function resourceName(resource) {
  return resource.metadata?.name ?? "";
}

function resourceNamespace(resource, fallback) {
  return resource.metadata?.namespace ?? fallback;
}

function legacyDisplayName(instance) {
  const annotations = annotationsOf(instance);
  return (
    annotations[LEGACY_LABELS.displayName] ||
    instance.spec?.title ||
    instance.spec?.defaults?.app_name?.value ||
    resourceName(instance)
  );
}

function kubectlBaseArgs(options) {
  const args = [];
  if (options.kubeconfig) {
    args.push("--kubeconfig", options.kubeconfig);
  }
  if (options.context) {
    args.push("--context", options.context);
  }
  return args;
}

function runKubectl(options, args, input) {
  return execFileSync("kubectl", [...kubectlBaseArgs(options), ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 100 * 1024 * 1024,
    stdio:
      input === undefined
        ? ["ignore", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
  });
}

function getResourceList(options, namespace, resourceType, selector) {
  const args = ["get", resourceType, "-n", namespace, "-o", "json"];
  if (selector) {
    args.push("-l", selector);
  }
  try {
    const raw = runKubectl(options, args);
    return JSON.parse(raw).items ?? [];
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    if (
      stderr.includes("the server doesn't have a resource type") ||
      stderr.includes("the server could not find the requested resource") ||
      stderr.includes("NotFound") ||
      stderr.includes("no matches for kind")
    ) {
      return [];
    }
    throw error;
  }
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
    kind: resource.kind ?? "",
    name: resourceName(resource),
    namespace: resourceNamespace(resource, namespace),
    type,
    uid: resource.metadata?.uid ?? "",
  };
}

function patchFor(resource, type, namespace, labels, reason) {
  return {
    addedLabels: labels,
    originalLabels: labelsOf(resource),
    reason,
    resource: resourceRef(resource, type, namespace),
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

function isBrainManaged(resource) {
  const labels = labelsOf(resource);
  return (
    labels[BRAIN_LABELS.managedBy] === "brain" ||
    typeof labels[BRAIN_LABELS.projectId] === "string"
  );
}

function isLegacyProjectCandidate(instance) {
  const labels = labelsOf(instance);
  const name = resourceName(instance);
  return (
    name !== "" &&
    !isBrainManaged(instance) &&
    labels[LEGACY_LABELS.deployOnSealos] === name
  );
}

function listInventoryProject(options, namespace, instance) {
  const instanceName = resourceName(instance);
  const projectId = deterministicProjectId(namespace, instance);
  const members = listProjectMembers(options, namespace, instanceName).map(
    (entry) => ({
      labels: labelsOf(entry.resource),
      resource: resourceRef(entry.resource, entry.type, namespace),
    })
  );
  const appNames = [
    ...new Set(
      members
        .map((entry) => entry.labels[LEGACY_LABELS.appDeployManager])
        .filter((value) => typeof value === "string" && value !== "")
    ),
  ];
  const supportResources = appNames.flatMap((appName) =>
    listApSupportResources(options, namespace, appName).map((entry) => ({
      labels: labelsOf(entry.resource),
      reason: `app-manager:${appName}`,
      resource: resourceRef(entry.resource, entry.type, namespace),
    }))
  );

  return {
    displayName: legacyDisplayName(instance),
    legacyInstance: {
      labels: labelsOf(instance),
      resource: resourceRef(instance, RESOURCE_TYPES.instance, namespace),
    },
    members,
    projectId,
    supportResources,
  };
}

function buildInventory(options) {
  const namespace = required(options.namespace, "--namespace");
  const instances = getResourceList(
    options,
    namespace,
    RESOURCE_TYPES.instance
  );
  const candidateInstances = instances.filter(isLegacyProjectCandidate);
  const skippedInstances = instances
    .filter((instance) => !isLegacyProjectCandidate(instance))
    .map((instance) => ({
      labels: labelsOf(instance),
      reason: isBrainManaged(instance)
        ? "already-brain-managed"
        : "not-a-legacy-project-candidate",
      resource: resourceRef(instance, RESOURCE_TYPES.instance, namespace),
    }));
  const projects = candidateInstances.map((instance) =>
    listInventoryProject(options, namespace, instance)
  );

  return {
    context: options.context ?? null,
    generatedAt: new Date().toISOString(),
    kubeconfig: options.kubeconfig ?? null,
    namespace,
    projects,
    skippedInstances,
    summary: {
      candidateProjects: projects.length,
      memberResources: projects.reduce(
        (sum, project) => sum + project.members.length,
        0
      ),
      skippedInstances: skippedInstances.length,
      supportResources: projects.reduce(
        (sum, project) => sum + project.supportResources.length,
        0
      ),
      totalInstances: instances.length,
    },
    version: MIGRATION_VERSION,
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

function listProjectMembers(options, namespace, instanceName) {
  const selector = `${LEGACY_LABELS.deployOnSealos}=${instanceName}`;
  return PROJECT_MEMBER_RESOURCE_TYPES.flatMap((type) =>
    getResourceList(options, namespace, type, selector).map((resource) => ({
      resource,
      type,
    }))
  );
}

function listApSupportResources(options, namespace, appName) {
  const selector = `${LEGACY_LABELS.appDeployManager}=${appName}`;
  return AP_SUPPORT_RESOURCE_TYPES.flatMap((type) =>
    getResourceList(options, namespace, type, selector).map((resource) => ({
      resource,
      type,
    }))
  );
}

function classifyAndBuildPatches(options, namespace, instance, projectId) {
  const instanceName = resourceName(instance);
  const memberEntries = listProjectMembers(options, namespace, instanceName);
  const patches = [];
  const skipped = [];
  const classifications = [];

  const appLikeEntries = memberEntries.filter(
    ({ resource }) => resource.kind === "App"
  );
  const apWorkloadEntries = memberEntries.filter(({ resource }) => {
    const kind = resource.kind;
    const labels = labelsOf(resource);
    return (
      (kind === "Deployment" || kind === "StatefulSet") &&
      typeof labels[LEGACY_LABELS.appDeployManager] === "string" &&
      labels[LEGACY_LABELS.appDeployManager] !== ""
    );
  });

  if (apWorkloadEntries.length > 0) {
    for (const entry of apWorkloadEntries) {
      const appName = labelsOf(entry.resource)[LEGACY_LABELS.appDeployManager];
      const labels = brainLabels(projectId, "ap", appName);
      patches.push(
        patchFor(entry.resource, entry.type, namespace, labels, "ap-workload")
      );
      classifications.push({
        deploymentKind: "ap",
        name: appName,
        resource: resourceRef(entry.resource, entry.type, namespace),
      });
      for (const support of listApSupportResources(
        options,
        namespace,
        appName
      )) {
        patches.push(
          patchFor(
            support.resource,
            support.type,
            namespace,
            labels,
            "ap-support-resource"
          )
        );
      }
    }
  }

  if (appLikeEntries.length > 0 || apWorkloadEntries.length === 0) {
    const labels = brainLabels(projectId, "template", instanceName);
    patches.push(
      patchFor(
        instance,
        RESOURCE_TYPES.instance,
        namespace,
        labels,
        appLikeEntries.length > 0
          ? "template-instance"
          : "legacy-empty-instance"
      )
    );
    for (const entry of appLikeEntries) {
      patches.push(
        patchFor(entry.resource, entry.type, namespace, labels, "template-app")
      );
    }
    classifications.push({
      deploymentKind: "template",
      name: instanceName,
      resource: resourceRef(instance, RESOURCE_TYPES.instance, namespace),
    });
  }

  for (const entry of memberEntries) {
    if (
      entry.resource.kind === "Devbox" ||
      entry.type.includes("devbox") ||
      entry.type === RESOURCE_TYPES.objectstoragebucket
    ) {
      skipped.push({
        reason: "unsupported-resource-kind",
        resource: resourceRef(entry.resource, entry.type, namespace),
      });
    }
    if (entry.resource.kind === "Cluster") {
      const labels = brainLabels(projectId, "db", resourceName(entry.resource));
      patches.push(
        patchFor(entry.resource, entry.type, namespace, labels, "db-cluster")
      );
      classifications.push({
        deploymentKind: "db",
        name: resourceName(entry.resource),
        resource: resourceRef(entry.resource, entry.type, namespace),
      });
    }
  }

  return {
    classifications,
    patches: dedupePatches(patches),
    skipped,
  };
}

function buildManifest(options) {
  if (options.inventory) {
    return buildManifestFromInventory(loadInventory(options.inventory));
  }
  const namespace = required(options.namespace, "--namespace");
  const instances = getResourceList(
    options,
    namespace,
    RESOURCE_TYPES.instance
  );
  const candidates = instances.filter(isLegacyProjectCandidate);
  const skippedInstances = instances
    .filter((instance) => !isLegacyProjectCandidate(instance))
    .map((instance) => ({
      labels: labelsOf(instance),
      reason: isBrainManaged(instance)
        ? "already-brain-managed"
        : "not-a-legacy-project-candidate",
      resource: resourceRef(instance, RESOURCE_TYPES.instance, namespace),
    }));

  const projects = candidates.map((instance) => {
    const projectId = deterministicProjectId(namespace, instance);
    const displayName = legacyDisplayName(instance);
    const project = {
      createdAt:
        instance.metadata?.creationTimestamp ?? new Date().toISOString(),
      description: `Imported from Brain v1 Instance ${resourceName(instance)}`,
      displayName,
      id: projectId,
      namespace,
    };
    const result = classifyAndBuildPatches(
      options,
      namespace,
      instance,
      projectId
    );
    return {
      classifications: result.classifications,
      insertSql: projectInsertSql(project),
      legacyInstance: resourceRef(instance, RESOURCE_TYPES.instance, namespace),
      patches: result.patches,
      project,
      skipped: result.skipped,
    };
  });

  return {
    context: options.context ?? null,
    generatedAt: new Date().toISOString(),
    kubeconfig: options.kubeconfig ?? null,
    mode: "dry-run",
    namespace,
    projects,
    skippedInstances,
    summary: {
      candidateProjects: projects.length,
      patches: projects.reduce(
        (sum, project) => sum + project.patches.length,
        0
      ),
      skippedInstances: skippedInstances.length,
      skippedResources: projects.reduce(
        (sum, project) => sum + project.skipped.length,
        0
      ),
      totalInstances: instances.length,
    },
    version: MIGRATION_VERSION,
  };
}

function buildManifestFromInventory(inventory) {
  const projects = inventory.projects.map((entry) => {
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
      createdAt: inventory.generatedAt,
      description: `Imported from Brain v1 Instance ${entry.legacyInstance.resource.name}`,
      displayName: entry.displayName,
      id: entry.projectId,
      namespace: inventory.namespace,
    };
    const memberPatches = entry.members.flatMap((member) =>
      patchesFromInventoryMember(member, entry, inventory.namespace)
    );
    const supportPatches = entry.supportResources.flatMap((support) =>
      patchesFromInventorySupport(support, entry, inventory.namespace)
    );
    const result = classifyInventoryProject(entry);
    return {
      classifications: result.classifications,
      insertSql: projectInsertSql(project),
      legacyInstance: resourceRef(
        instance,
        RESOURCE_TYPES.instance,
        inventory.namespace
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
    projects,
    skippedInstances: inventory.skippedInstances,
    summary: {
      candidateProjects: projects.length,
      patches: projects.reduce(
        (sum, project) => sum + project.patches.length,
        0
      ),
      skippedInstances: inventory.skippedInstances.length,
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

function classifyInventoryProject(entry) {
  const classifications = [];
  const instancePatches = [];
  const skipped = [];
  const apMembers = entry.members.filter(
    (member) =>
      (member.resource.kind === "Deployment" ||
        member.resource.kind === "StatefulSet") &&
      typeof member.labels[LEGACY_LABELS.appDeployManager] === "string" &&
      member.labels[LEGACY_LABELS.appDeployManager] !== ""
  );
  const appMembers = entry.members.filter(
    (member) => member.resource.kind === "App"
  );
  if (appMembers.length > 0 || apMembers.length === 0) {
    const labels = brainLabels(
      entry.projectId,
      "template",
      entry.legacyInstance.resource.name
    );
    instancePatches.push({
      addedLabels: labels,
      originalLabels: entry.legacyInstance.labels,
      reason:
        appMembers.length > 0 ? "template-instance" : "legacy-empty-instance",
      resource: entry.legacyInstance.resource,
    });
    classifications.push({
      deploymentKind: "template",
      name: entry.legacyInstance.resource.name,
      resource: entry.legacyInstance.resource,
    });
  }
  for (const member of entry.members) {
    if (
      member.resource.kind === "Cluster" ||
      member.resource.type === RESOURCE_TYPES.objectstoragebucket
    ) {
      skipped.push({
        reason: "requires-manual-review",
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
    `-- Namespace: ${manifest.namespace}`,
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

function writeInventoryOutput(inventory, outDir) {
  mkdirSync(outDir, { recursive: true });
  const inventoryPath = path.join(outDir, "inventory.json");
  writeFileSync(
    inventoryPath,
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8"
  );
  return { inventoryPath };
}

function loadInventory(inventoryPath) {
  if (!existsSync(inventoryPath)) {
    throw new Error(`Inventory not found: ${inventoryPath}`);
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (inventory.version !== MIGRATION_VERSION) {
    throw new Error(
      `Unsupported inventory version: ${inventory.version}; expected ${MIGRATION_VERSION}`
    );
  }
  return inventory;
}

function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== MIGRATION_VERSION) {
    throw new Error(
      `Unsupported manifest version: ${manifest.version}; expected ${MIGRATION_VERSION}`
    );
  }
  return manifest;
}

function applyOptionsFromManifest(manifest) {
  return {
    context: manifest.context ?? undefined,
    kubeconfig: manifest.kubeconfig ?? undefined,
  };
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
      for (const project of manifest.projects) {
        await client.query(project.insertSql);
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
  const namespace = options.inventory
    ? sanitizeFilePart(loadInventory(options.inventory).namespace)
    : required(options.namespace, "--namespace");
  const outDir =
    options.out ??
    path.join(
      ".migration",
      `brain-v1-${sanitizeFilePart(namespace)}-${Date.now()}`
    );
  const manifest = buildManifest(options);
  const outputs = writeDryRunOutputs(manifest, outDir);
  console.log(JSON.stringify({ outputs, summary: manifest.summary }, null, 2));
}

function inventory(options) {
  const namespace = required(options.namespace, "--namespace");
  const outDir =
    options.out ??
    path.join(
      ".migration",
      `brain-v1-${sanitizeFilePart(namespace)}-${Date.now()}`
    );
  const result = buildInventory(options);
  const outputs = writeInventoryOutput(result, outDir);
  console.log(JSON.stringify({ outputs, summary: result.summary }, null, 2));
}

async function apply(options) {
  requireConfirmation(options);
  const manifest = loadManifest(required(options.manifest, "--manifest"));
  const databaseUrl = options["database-url"] ?? process.env.DATABASE_URL ?? "";
  required(databaseUrl, "--database-url or DATABASE_URL");
  await insertProjects(databaseUrl, manifest);
  const kubeOptions = applyOptionsFromManifest(manifest);
  for (const project of manifest.projects) {
    for (const patch of project.patches) {
      patchResourceLabels(kubeOptions, patch);
      console.log(
        `patched ${patch.resource.type}/${patch.resource.name} ${patch.resource.namespace}`
      );
    }
  }
  console.log("apply complete");
}

async function rollback(options) {
  requireConfirmation(options);
  const manifest = loadManifest(required(options.manifest, "--manifest"));
  const databaseUrl = options["database-url"] ?? process.env.DATABASE_URL ?? "";
  required(databaseUrl, "--database-url or DATABASE_URL");
  const kubeOptions = applyOptionsFromManifest(manifest);
  for (const project of [...manifest.projects].reverse()) {
    for (const patch of [...project.patches].reverse()) {
      removeResourceLabels(kubeOptions, patch);
      console.log(
        `removed labels from ${patch.resource.type}/${patch.resource.name} ${patch.resource.namespace}`
      );
    }
  }
  await deleteProjects(databaseUrl, manifest);
  console.log("rollback complete");
}

async function main() {
  const { mode, options } = parseArgs(process.argv.slice(2));
  if (!mode || mode === "help" || options.help) {
    console.log(usage());
    return;
  }
  if (mode === "dry-run") {
    dryRun(options);
    return;
  }
  if (mode === "inventory") {
    inventory(options);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
