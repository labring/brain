#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import k8s from "@kubernetes/client-node";

const GROUP = "devbox.sealos.io";
const VERSION = "v1alpha2";
const PLURAL = "devboxes";
const EXPECTED_FINALIZER = "devbox.sealos.io/finalizer";
const DELETE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CANDIDATES = 200;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DELETE_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const USER_NAMESPACE_PREFIX = "ns-";
const STANDARD_NAME_RE = /^sealai-(chat|deploy)-([0-9a-f]{20})$/;
const DEBUG_NAME_RE = /^sealai-debug-[a-z0-9]+$/;
const DURATION_RE = /^((?:\d+(?:\.\d+)?)(?:d|h|m|s))+$/i;
const DURATION_PART_RE = /([0-9]+(?:\.[0-9]+)?)(d|h|m|s)/gi;
const MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
const COMPONENT_LABEL = "app.kubernetes.io/component";
const LIFECYCLE_LABEL = "devbox.sealos.io/lifecycle-scheduled";
const UPSTREAM_LABEL = "devbox.sealos.io/upstream-id";
const DEBUG_SOURCE_LABEL = "brain.io/debug-source-task";
const PAUSED_AT_ANNOTATION = "devbox.sealos.io/paused-at";
const ARCHIVE_TRIGGERED_AT_ANNOTATION = "devbox.sealos.io/archive-triggered-at";
const ARCHIVE_AFTER_ANNOTATION = "devbox.sealos.io/archive-after-pause-time";

function usage() {
  console.error(`Usage:
  bun scripts/devbox-admin-cleanup.mjs inventory --namespace <ns> [options]
  bun scripts/devbox-admin-cleanup.mjs execute --namespace <ns> --inventory <file> --confirm-fingerprint <sha256> [options]

Options:
  --kubeconfig <file>       Admin kubeconfig (required).
  --all-namespaces          Scan all namespaces whose names start with ns-.
  --include-debug           Include sealai-debug-* only when its Brain debug label is present.
  --output <file>           Inventory/audit JSON file. Inventory defaults to stdout.
  --inventory <file>        Inventory file for execute mode.
  --confirm-fingerprint <x> Required for execute mode; must match the inventory snapshot.
  --max-candidates <n>      Abort when the inventory has more candidates (default: ${DEFAULT_MAX_CANDIDATES}).
  --now <RFC3339>           Deterministic inventory clock (default: current UTC time).
  --request-timeout-ms <n> Kubernetes request timeout (default: ${DEFAULT_REQUEST_TIMEOUT_MS}).
  --delete-timeout-ms <n>  Wait timeout after delete (default: ${DEFAULT_DELETE_TIMEOUT_MS}).
  --help                    Show this help.
`);
}

function parseArgs(argv) {
  const [command = "inventory", ...rest] = argv;
  if (command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }
  if (command !== "inventory" && command !== "execute") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = {
    allNamespaces: false,
    command,
    confirmFingerprint: null,
    deleteTimeoutMs: DEFAULT_DELETE_TIMEOUT_MS,
    includeDebug: false,
    inventory: null,
    kubeconfig: null,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    namespace: null,
    now: new Date(),
    output: null,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    const next = () => {
      const value = rest[index + 1];
      if (value == null || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case "--all-namespaces":
        options.allNamespaces = true;
        break;
      case "--confirm-fingerprint":
        options.confirmFingerprint = next();
        break;
      case "--delete-timeout-ms":
        options.deleteTimeoutMs = positiveInteger(next(), arg);
        break;
      case "--include-debug":
        options.includeDebug = true;
        break;
      case "--inventory":
        options.inventory = next();
        break;
      case "--kubeconfig":
        options.kubeconfig = next();
        break;
      case "--max-candidates":
        options.maxCandidates = positiveInteger(next(), arg);
        break;
      case "--namespace":
        options.namespace = next().trim();
        break;
      case "--now":
        options.now = parseDate(next(), arg);
        break;
      case "--output":
        options.output = next();
        break;
      case "--request-timeout-ms":
        options.requestTimeoutMs = positiveInteger(next(), arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.allNamespaces === (options.namespace != null)) {
    throw new Error("Provide exactly one of --namespace or --all-namespaces");
  }
  if (options.kubeconfig == null) {
    throw new Error("--kubeconfig is required");
  }
  if (options.namespace != null && !isUserNamespace(options.namespace)) {
    throw new Error("--namespace must start with ns-");
  }
  if (options.command === "execute" && options.inventory == null) {
    throw new Error("execute requires --inventory <file>");
  }
  if (options.command === "execute" && !options.confirmFingerprint) {
    throw new Error("execute requires --confirm-fingerprint <sha256>");
  }
  return options;
}

function isUserNamespace(namespace) {
  return (
    typeof namespace === "string" && namespace.startsWith(USER_NAMESPACE_PREFIX)
  );
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseDate(value, flag) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} must be a valid RFC3339 timestamp`);
  }
  return date;
}

function loadKubeConfig(kubeconfigPath) {
  if (typeof kubeconfigPath !== "string" || kubeconfigPath.trim() === "") {
    throw new Error("--kubeconfig is required");
  }
  const config = new k8s.KubeConfig();
  config.loadFromFile(path.resolve(kubeconfigPath));
  return config;
}

function addRequestTimeout(client, requestTimeoutMs) {
  client.addInterceptor((requestOptions) => {
    requestOptions.timeout = requestTimeoutMs;
  });
  return client;
}

function apiClients(kubeconfigPath, requestTimeoutMs) {
  const config = loadKubeConfig(kubeconfigPath);
  const customObjects = addRequestTimeout(
    config.makeApiClient(k8s.CustomObjectsApi),
    requestTimeoutMs
  );
  const core = addRequestTimeout(
    config.makeApiClient(k8s.CoreV1Api),
    requestTimeoutMs
  );
  return { core, customObjects };
}

function apiClient(kubeconfigPath, requestTimeoutMs) {
  return apiClients(kubeconfigPath, requestTimeoutMs).customObjects;
}

function listResponseItems(response) {
  const body = responseBody(response);
  return Array.isArray(body?.items) ? body.items : [];
}

async function listUserNamespaces(core) {
  const namespaces = listResponseItems(await core.listNamespace());
  const userNamespaces = namespaces
    .map((item) => metadataOf(item).name)
    .filter(isUserNamespace);
  if (userNamespaces.length === 0) {
    throw new Error("no ns-* user namespaces found");
  }
  return userNamespaces;
}

async function collectInBatches(items, concurrency, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(mapper))));
  }
  return results;
}

function responseBody(response) {
  return response?.body ?? response;
}

function metadataOf(object) {
  return object?.metadata && typeof object.metadata === "object"
    ? object.metadata
    : {};
}

function labelsOf(object) {
  const labels = metadataOf(object).labels;
  return labels && typeof labels === "object" ? labels : {};
}

function annotationsOf(object) {
  const annotations = metadataOf(object).annotations;
  return annotations && typeof annotations === "object" ? annotations : {};
}

function stateOf(object) {
  return {
    phase: String(object?.status?.phase ?? ""),
    spec: String(object?.spec?.state ?? ""),
    status: String(object?.status?.state ?? ""),
  };
}

function envValue(object, name) {
  const env = object?.spec?.config?.env;
  if (!Array.isArray(env)) {
    return null;
  }
  const entry = env.find(
    (item) => item && typeof item === "object" && item.name === name
  );
  return typeof entry?.value === "string" && entry.value.trim() !== ""
    ? entry.value.trim()
    : null;
}

function parseDurationMs(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = DURATION_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  let total = 0;
  for (const part of value.matchAll(DURATION_PART_RE)) {
    const amount = Number(part[1]);
    const multiplier = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 }[
      part[2].toLowerCase()
    ];
    total += amount * multiplier;
  }
  return Number.isFinite(total) ? total : null;
}

function dateValue(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nameClass(name, includeDebug) {
  const standard = STANDARD_NAME_RE.exec(name);
  if (standard) {
    return { kind: standard[1], standard: true };
  }
  if (DEBUG_NAME_RE.test(name)) {
    return includeDebug ? { kind: "debug", debug: true } : null;
  }
  return null;
}

function expectedUpstreamId(name, nameInfo, upstreamId) {
  if (typeof upstreamId !== "string" || upstreamId.trim() === "") {
    return false;
  }
  if (nameInfo.debug) {
    return upstreamId === name;
  }
  return new RegExp(`^${name}[0-9a-f]{12}$`).test(upstreamId);
}

function labelReasons(object, nameInfo) {
  const labels = labelsOf(object);
  const metadata = metadataOf(object);
  const name = String(metadata.name ?? "");
  const component = labels[COMPONENT_LABEL];
  const reasons = [];
  if (!nameInfo) {
    reasons.push(
      DEBUG_NAME_RE.test(name) ? "debug-not-enabled" : "name-not-brain-runtime"
    );
  }
  if (labels[MANAGED_BY_LABEL] !== "sealai") {
    reasons.push("managed-by-label-missing");
  }
  if (component !== "assistant-runtime" && component !== "deploy-runtime") {
    reasons.push("component-label-unknown");
  }
  if (
    (nameInfo?.kind === "chat" && component !== "assistant-runtime") ||
    ((nameInfo?.kind === "deploy" || nameInfo?.kind === "debug") &&
      component !== "deploy-runtime")
  ) {
    reasons.push("name-component-mismatch");
  }
  if (
    nameInfo?.debug &&
    (typeof labels[DEBUG_SOURCE_LABEL] !== "string" ||
      labels[DEBUG_SOURCE_LABEL].trim() === "")
  ) {
    reasons.push("debug-source-task-missing");
  }
  if (nameInfo?.debug && envValue(object, "SEALAI_DEPLOY_TASK_ID") == null) {
    reasons.push("debug-deploy-task-id-missing");
  }
  if (labels[LIFECYCLE_LABEL] !== "true") {
    reasons.push("lifecycle-label-missing");
  }
  if (!expectedUpstreamId(name, nameInfo ?? {}, labels[UPSTREAM_LABEL])) {
    reasons.push("upstream-id-mismatch");
  }
  return reasons;
}

function metadataSafetyReasons(object) {
  const metadata = metadataOf(object);
  const reasons = [];
  if (metadata.deletionTimestamp != null) {
    reasons.push("deletion-already-requested");
  }
  if (
    typeof metadata.namespace !== "string" ||
    metadata.namespace.trim() === "" ||
    typeof metadata.uid !== "string" ||
    metadata.uid.trim() === "" ||
    typeof metadata.resourceVersion !== "string" ||
    metadata.resourceVersion.trim() === ""
  ) {
    reasons.push("metadata-identity-missing");
  }
  const ownerReferences = Array.isArray(metadata.ownerReferences)
    ? metadata.ownerReferences
    : [];
  if (ownerReferences.length > 0) {
    reasons.push("owner-references-present");
  }
  const finalizers = Array.isArray(metadata.finalizers)
    ? [...metadata.finalizers].sort()
    : [];
  if (finalizers.length !== 1 || finalizers[0] !== EXPECTED_FINALIZER) {
    reasons.push("unexpected-finalizer");
  }
  return reasons;
}

function ownershipReasons(object, nameInfo) {
  return [...labelReasons(object, nameInfo), ...metadataSafetyReasons(object)];
}

function runtimeStateReasons(state) {
  const reasons = [];
  if (state.spec !== "Shutdown") {
    reasons.push(
      state.spec === "Paused"
        ? "paused-not-archived"
        : "spec-state-not-shutdown"
    );
  }
  if (state.status !== "Shutdown") {
    reasons.push("status-state-not-shutdown");
  }
  if (state.phase !== "Shutdown") {
    reasons.push("phase-not-shutdown");
  }
  return reasons;
}

function lifecycleTimeReasons({
  archiveAfterMs,
  archiveTriggeredAt,
  now,
  pausedAt,
}) {
  const reasons = [];
  if (!pausedAt) {
    reasons.push("paused-at-missing-or-invalid");
  }
  if (!archiveTriggeredAt) {
    reasons.push("archive-triggered-at-missing-or-invalid");
  }
  if (pausedAt && archiveTriggeredAt && archiveTriggeredAt < pausedAt) {
    reasons.push("archive-triggered-before-paused");
  }
  if (archiveTriggeredAt && archiveTriggeredAt > now) {
    reasons.push("archive-triggered-in-future");
  }
  if (archiveAfterMs == null) {
    reasons.push("archive-after-pause-time-missing-or-invalid");
  }
  if (archiveAfterMs != null && archiveAfterMs < DELETE_AFTER_MS) {
    reasons.push("archive-retention-shorter-than-24h");
  }
  if (
    pausedAt &&
    pausedAt.getTime() + Math.max(DELETE_AFTER_MS, archiveAfterMs ?? 0) >
      now.getTime()
  ) {
    reasons.push("pause-age-under-retention");
  }
  return reasons;
}

function reasonsFor(object, options) {
  const metadata = metadataOf(object);
  const annotations = annotationsOf(object);
  const name = String(metadata.name ?? "");
  const nameInfo = nameClass(name, options.includeDebug);
  const state = stateOf(object);
  const pausedAt = dateValue(annotations[PAUSED_AT_ANNOTATION]);
  const archiveTriggeredAt = dateValue(
    annotations[ARCHIVE_TRIGGERED_AT_ANNOTATION]
  );
  const archiveAfterMs = parseDurationMs(annotations[ARCHIVE_AFTER_ANNOTATION]);
  const reasons = [
    ...ownershipReasons(object, nameInfo),
    ...runtimeStateReasons(state),
    ...lifecycleTimeReasons({
      archiveAfterMs,
      archiveTriggeredAt,
      now: options.now,
      pausedAt,
    }),
  ];
  return { nameInfo, pausedAt, archiveTriggeredAt, state, reasons };
}

function safeSnapshot(object, options, evaluation) {
  const metadata = metadataOf(object);
  const labels = labelsOf(object);
  const annotations = annotationsOf(object);
  const taskId = envValue(object, "SEALAI_DEPLOY_TASK_ID");
  return {
    namespace: String(metadata.namespace ?? options.namespace ?? ""),
    name: String(metadata.name ?? ""),
    uid: String(metadata.uid ?? ""),
    resourceVersion: String(metadata.resourceVersion ?? ""),
    creationTimestamp: String(metadata.creationTimestamp ?? ""),
    component: String(labels[COMPONENT_LABEL] ?? ""),
    upstreamId: String(labels[UPSTREAM_LABEL] ?? ""),
    debugSourceTask: String(labels[DEBUG_SOURCE_LABEL] ?? ""),
    deployTaskId: taskId,
    specState: evaluation.state.spec,
    statusState: evaluation.state.status,
    phase: evaluation.state.phase,
    pausedAt: annotations[PAUSED_AT_ANNOTATION] ?? null,
    archiveTriggeredAt: annotations[ARCHIVE_TRIGGERED_AT_ANNOTATION] ?? null,
    archiveAfterPauseTime: annotations[ARCHIVE_AFTER_ANNOTATION] ?? null,
    reasons: evaluation.reasons,
  };
}

function fingerprint(candidates) {
  const canonical = candidates
    .map(({ namespace, name, uid, resourceVersion }) => ({
      name,
      namespace,
      resourceVersion,
      uid,
    }))
    .sort((a, b) =>
      `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`)
    );
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

async function listNamespacedDevboxes(api, namespace) {
  return listResponseItems(
    await api.listNamespacedCustomObject(GROUP, VERSION, namespace, PLURAL)
  );
}

async function listDevboxes(api, core, options) {
  if (!options.allNamespaces) {
    return listNamespacedDevboxes(api, options.namespace);
  }
  const namespaces = await listUserNamespaces(core);
  const batches = await collectInBatches(
    namespaces,
    DEFAULT_CONCURRENCY,
    (namespace) => listNamespacedDevboxes(api, namespace)
  );
  return batches.flat();
}

async function getDevbox(api, namespace, name) {
  const response = await api.getNamespacedCustomObject(
    GROUP,
    VERSION,
    namespace,
    PLURAL,
    name
  );
  return responseBody(response);
}

async function deleteDevbox(api, candidate) {
  const body = {
    propagationPolicy: "Foreground",
    preconditions: {
      resourceVersion: candidate.resourceVersion,
      uid: candidate.uid,
    },
  };
  return await api.deleteNamespacedCustomObject(
    GROUP,
    VERSION,
    candidate.namespace,
    PLURAL,
    candidate.name,
    undefined,
    undefined,
    "Foreground",
    undefined,
    body
  );
}

async function waitForMissing(api, candidate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await getDevbox(api, candidate.namespace, candidate.name);
    } catch (error) {
      if (statusCode(error) === 404) {
        return true;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function statusCode(error) {
  return error?.statusCode ?? error?.response?.statusCode ?? error?.body?.code;
}

function errorSummary(error) {
  const status = statusCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return status ? `${status}: ${message}` : message;
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summaryOf(items) {
  return items.reduce((summary, item) => {
    const key = item.reasons.length === 0 ? "candidate" : item.reasons[0];
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

async function inventory(options) {
  const { core, customObjects } = apiClients(
    options.kubeconfig,
    options.requestTimeoutMs
  );
  const objects = await listDevboxes(customObjects, core, options);
  const snapshots = objects.map((object) => {
    const evaluation = reasonsFor(object, options);
    return safeSnapshot(object, options, evaluation);
  });
  const candidates = snapshots.filter((item) => item.reasons.length === 0);
  if (candidates.length > options.maxCandidates) {
    throw new Error(
      `candidate count ${candidates.length} exceeds --max-candidates ${options.maxCandidates}`
    );
  }
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evaluatedAt: options.now.toISOString(),
    namespace: options.namespace,
    allNamespaces: options.allNamespaces,
    includeDebug: options.includeDebug,
    retentionMs: DELETE_AFTER_MS,
    fingerprint: fingerprint(candidates),
    counts: {
      scanned: snapshots.length,
      candidates: candidates.length,
      skipped: snapshots.length - candidates.length,
      byReason: summaryOf(snapshots),
    },
    candidates,
    skipped: snapshots.filter((item) => item.reasons.length > 0),
  };
  if (options.output) {
    await writeJson(options.output, result);
  }
  console.log(JSON.stringify({ ...result, skipped: undefined }, null, 2));
  return result;
}

async function execute(options) {
  const inventoryResult = JSON.parse(
    await fs.readFile(options.inventory, "utf8")
  );
  if (inventoryResult.schemaVersion !== 1) {
    throw new Error("unsupported inventory schema version");
  }
  if (
    inventoryResult.namespace !== options.namespace ||
    inventoryResult.allNamespaces !== options.allNamespaces
  ) {
    throw new Error("inventory scope does not match execute scope");
  }
  if (inventoryResult.includeDebug !== options.includeDebug) {
    throw new Error("--include-debug must match the inventory snapshot");
  }
  if (inventoryResult.fingerprint !== options.confirmFingerprint) {
    throw new Error(
      "inventory fingerprint does not match --confirm-fingerprint"
    );
  }
  if (!Array.isArray(inventoryResult.candidates)) {
    throw new Error("inventory candidates must be an array");
  }
  if (
    inventoryResult.candidates.some(
      (candidate) => !isUserNamespace(candidate?.namespace)
    )
  ) {
    throw new Error("inventory candidates must be in ns-* namespaces");
  }
  if (inventoryResult.candidates.length > options.maxCandidates) {
    throw new Error(
      `candidate count ${inventoryResult.candidates.length} exceeds --max-candidates ${options.maxCandidates}`
    );
  }
  if (fingerprint(inventoryResult.candidates) !== inventoryResult.fingerprint) {
    throw new Error("inventory candidates do not match its fingerprint");
  }
  const api = apiClient(options.kubeconfig, options.requestTimeoutMs);
  const audit = {
    schemaVersion: 1,
    executedAt: new Date().toISOString(),
    inventory: options.inventory,
    fingerprint: inventoryResult.fingerprint,
    results: [],
  };
  for (
    let index = 0;
    index < inventoryResult.candidates.length;
    index += DEFAULT_CONCURRENCY
  ) {
    const batch = inventoryResult.candidates.slice(
      index,
      index + DEFAULT_CONCURRENCY
    );
    const results = await Promise.all(
      batch.map(async (candidate) => {
        const result = { ...candidate, outcome: null, error: null };
        try {
          const current = await getDevbox(
            api,
            candidate.namespace,
            candidate.name
          );
          const evaluation = reasonsFor(current, {
            ...options,
            now: new Date(),
          });
          const metadata = metadataOf(current);
          if (
            String(metadata.uid ?? "") !== candidate.uid ||
            String(metadata.resourceVersion ?? "") !== candidate.resourceVersion
          ) {
            result.outcome = "stale-inventory";
            return result;
          }
          if (evaluation.reasons.length > 0) {
            result.outcome = "recheck-rejected";
            result.error = evaluation.reasons.join(",");
            return result;
          }
          await deleteDevbox(api, candidate);
          result.outcome = (await waitForMissing(
            api,
            candidate,
            options.deleteTimeoutMs
          ))
            ? "deleted"
            : "delete-pending";
          return result;
        } catch (error) {
          result.outcome =
            statusCode(error) === 404 ? "already-missing" : "failed";
          result.error = errorSummary(error);
          return result;
        }
      })
    );
    audit.results.push(...results);
  }
  if (options.output) {
    await writeJson(options.output, audit);
  }
  console.log(JSON.stringify(audit, null, 2));
  return audit;
}

try {
  if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "inventory") {
      await inventory(options);
    } else {
      await execute(options);
    }
  }
} catch (error) {
  console.error(`devbox-admin-cleanup: ${errorSummary(error)}`);
  process.exitCode = 1;
}

export {
  collectInBatches,
  isUserNamespace,
  listDevboxes,
  listUserNamespaces,
  parseArgs,
  reasonsFor,
};
