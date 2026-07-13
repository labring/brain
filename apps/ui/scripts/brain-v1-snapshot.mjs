import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { createInterface } from "node:readline";
import { KubeConfig } from "@kubernetes/client-node";

const LEGACY_LABELS = {
  appDeployManager: "cloud.sealos.io/app-deploy-manager",
  deployOnSealos: "cloud.sealos.io/deploy-on-sealos",
};

const SNAPSHOT_VERSION = 1;
const INVENTORY_SCHEMA = "brain-v1-inventory/v2";
const INVENTORY_VERSION = 2;
const DECISIONS_SCHEMA = "brain-v1-classification-decisions/v1";
const PARTIAL_METADATA_ACCEPT =
  "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";
const MAX_PAGE_BYTES = 128 * 1024 * 1024;
const API_GROUP_VERSION_PATH_PATTERN = /^\/apis\/([^/]+)\/([^/]+)\//;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

class ResourceExpiredError extends Error {}

class KubernetesHttpError extends Error {
  constructor(definitionId, response) {
    super(
      `Kubernetes list failed for ${definitionId}: ${response.status} ${response.statusText}`
    );
    this.retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
  }
}

function definition(input) {
  return Object.freeze(input);
}

export const SNAPSHOT_DEFINITIONS = Object.freeze([
  definition({
    apiVersion: "app.sealos.io/v1",
    id: "instances",
    kind: "Instance",
    metadataOnly: false,
    path: "/apis/app.sealos.io/v1/instances",
    role: "instance",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "instances.app.sealos.io",
  }),
  definition({
    apiVersion: "apps/v1",
    id: "member-deployments",
    kind: "Deployment",
    metadataOnly: true,
    path: "/apis/apps/v1/deployments",
    role: "member",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "deployments",
  }),
  definition({
    apiVersion: "apps/v1",
    id: "member-statefulsets",
    kind: "StatefulSet",
    metadataOnly: true,
    path: "/apis/apps/v1/statefulsets",
    role: "member",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "statefulsets",
  }),
  definition({
    apiVersion: "v1",
    id: "member-configmaps",
    kind: "ConfigMap",
    metadataOnly: true,
    path: "/api/v1/configmaps",
    role: "member",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "configmaps",
  }),
  definition({
    apiVersion: "app.sealos.io/v1",
    id: "member-apps",
    kind: "App",
    metadataOnly: true,
    optional: true,
    path: "/apis/app.sealos.io/v1/apps",
    role: "member",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "apps.app.sealos.io",
  }),
  definition({
    apiVersion: "apps.kubeblocks.io/v1alpha1",
    id: "member-clusters",
    kind: "Cluster",
    metadataOnly: true,
    optional: true,
    path: "/apis/apps.kubeblocks.io/v1alpha1/clusters",
    role: "member",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "clusters.apps.kubeblocks.io",
  }),
  definition({
    apiVersion: "objectstorage.sealos.io/v1",
    id: "member-objectstoragebuckets",
    kind: "ObjectStorageBucket",
    metadataOnly: true,
    optional: true,
    path: "/apis/objectstorage.sealos.io/v1/objectstoragebuckets",
    role: "member",
    selector: LEGACY_LABELS.deployOnSealos,
    type: "objectstoragebuckets.objectstorage.sealos.io",
  }),
  definition({
    apiVersion: "v1",
    id: "support-services",
    kind: "Service",
    metadataOnly: true,
    path: "/api/v1/services",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "services",
  }),
  definition({
    apiVersion: "networking.k8s.io/v1",
    id: "support-ingresses",
    kind: "Ingress",
    metadataOnly: true,
    path: "/apis/networking.k8s.io/v1/ingresses",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "ingresses",
  }),
  definition({
    apiVersion: "v1",
    id: "support-configmaps",
    kind: "ConfigMap",
    metadataOnly: true,
    path: "/api/v1/configmaps",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "configmaps",
  }),
  definition({
    apiVersion: "v1",
    id: "support-persistentvolumeclaims",
    kind: "PersistentVolumeClaim",
    metadataOnly: true,
    path: "/api/v1/persistentvolumeclaims",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "persistentvolumeclaims",
  }),
  definition({
    apiVersion: "v1",
    id: "support-secrets",
    kind: "Secret",
    metadataOnly: true,
    path: "/api/v1/secrets",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "secrets",
  }),
  definition({
    apiVersion: "cert-manager.io/v1",
    id: "support-issuers",
    kind: "Issuer",
    metadataOnly: true,
    optional: true,
    path: "/apis/cert-manager.io/v1/issuers",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "issuers.cert-manager.io",
  }),
  definition({
    apiVersion: "cert-manager.io/v1",
    id: "support-certificates",
    kind: "Certificate",
    metadataOnly: true,
    optional: true,
    path: "/apis/cert-manager.io/v1/certificates",
    role: "support",
    selector: LEGACY_LABELS.appDeployManager,
    type: "certificates.cert-manager.io",
  }),
]);
const SNAPSHOT_DEFINITION_FINGERPRINT = sha256Text(
  JSON.stringify(SNAPSHOT_DEFINITIONS)
);

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clusterIdentityFingerprint(kubeConfig, contextName, kubeconfigSha256) {
  const context = kubeConfig.getContextObject(contextName);
  const cluster = kubeConfig.getCurrentCluster();
  if (!(context && cluster)) {
    throw new Error(`Kubernetes context not found: ${contextName}`);
  }
  let caSha256 = "";
  if (cluster.caData) {
    caSha256 = sha256Text(cluster.caData);
  } else if (cluster.caFile && existsSync(cluster.caFile)) {
    caSha256 = createHash("sha256")
      .update(readFileSync(cluster.caFile))
      .digest("hex");
  }
  return sha256Text(
    JSON.stringify({
      caSha256,
      cluster: context.cluster,
      context: contextName,
      kubeconfigSha256,
      server: cluster.server,
      skipTLSVerify: cluster.skipTLSVerify,
      tlsServerName: cluster.tlsServerName ?? "",
      user: context.user,
    })
  );
}

function loadExplicitKubeConfig(kubeconfigPath, contextName) {
  const kubeconfigBytes = readFileSync(kubeconfigPath);
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromString(kubeconfigBytes.toString("utf8"));
  kubeConfig.makePathsAbsolute(path.dirname(kubeconfigPath));
  if (!kubeConfig.getContextObject(contextName)) {
    throw new Error(`Kubernetes context not found: ${contextName}`);
  }
  kubeConfig.setCurrentContext(contextName);
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) {
    throw new Error(`Kubernetes context has no cluster: ${contextName}`);
  }
  for (const clusterValue of kubeConfig.clusters) {
    if (clusterValue.caFile) {
      clusterValue.caData = readFileSync(clusterValue.caFile).toString(
        "base64"
      );
      clusterValue.caFile = undefined;
    }
  }
  for (const user of kubeConfig.users) {
    if (user.certFile) {
      user.certData = readFileSync(user.certFile).toString("base64");
      user.certFile = undefined;
    }
    if (user.keyFile) {
      user.keyData = readFileSync(user.keyFile).toString("base64");
      user.keyFile = undefined;
    }
  }
  return {
    cluster,
    kubeConfig,
    kubeconfigSha256: createHash("sha256")
      .update(kubeconfigBytes)
      .digest("hex"),
  };
}

export function kubeconfigSourceFingerprint(kubeconfigPath, contextName) {
  const { kubeConfig, kubeconfigSha256 } = loadExplicitKubeConfig(
    kubeconfigPath,
    contextName
  );
  return clusterIdentityFingerprint(kubeConfig, contextName, kubeconfigSha256);
}

export function verifiedKubeconfigContents(
  kubeconfigPath,
  contextName,
  expectedFingerprint
) {
  const { kubeConfig, kubeconfigSha256 } = loadExplicitKubeConfig(
    kubeconfigPath,
    contextName
  );
  const actualFingerprint = clusterIdentityFingerprint(
    kubeConfig,
    contextName,
    kubeconfigSha256
  );
  if (actualFingerprint !== expectedFingerprint) {
    throw new Error(
      "Migration manifest source fingerprint does not match the current kubeconfig/context"
    );
  }
  return kubeConfig.exportConfig();
}

function nodeResponse(response, chunks) {
  const body = Buffer.concat(chunks).toString("utf8");
  const status = response.statusCode ?? 0;
  return {
    json: async () => JSON.parse(body),
    ok: status >= 200 && status < 300,
    status,
    statusText: response.statusMessage ?? "",
  };
}

function requestWithKubeconfig(kubeConfig, allowedPaths) {
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) {
    throw new Error("Kubernetes context has no active cluster");
  }
  const server = new URL(cluster.server);
  return async (inputUrl, init = {}) => {
    const url = new URL(inputUrl);
    if (
      url.origin !== server.origin ||
      !allowedPaths.has(url.pathname) ||
      init.method !== "GET"
    ) {
      throw new Error(`Refusing unexpected Kubernetes request: ${url}`);
    }
    const requestOptions = {
      headers: { ...(init.headers ?? {}) },
      method: "GET",
      signal: init.signal,
    };
    await kubeConfig.applytoHTTPSOptions(requestOptions);
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const request = requestImpl(url, requestOptions, (response) => {
        const chunks = [];
        let receivedBytes = 0;
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_PAGE_BYTES) {
            response.destroy(
              new Error(
                `Kubernetes page exceeded ${MAX_PAGE_BYTES} bytes: ${url.pathname}`
              )
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve(nodeResponse(response, chunks)));
      });
      request.on("error", reject);
      request.end();
    });
  };
}

async function validateConfiguredApiVersions(fetchImpl, baseUrl, timeoutMs) {
  const response = await fetchImpl(new URL("/apis", baseUrl), {
    headers: { Accept: "application/json" },
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Kubernetes API discovery failed: ${response.status} ${response.statusText}`
    );
  }
  const discovery = await response.json();
  const groups = new Map(
    (discovery.groups ?? []).map((group) => [
      group.name,
      new Set((group.versions ?? []).map((version) => version.version)),
    ])
  );
  for (const definitionValue of SNAPSHOT_DEFINITIONS) {
    const match = definitionValue.path.match(API_GROUP_VERSION_PATH_PATTERN);
    if (!match) {
      continue;
    }
    const [, groupName, version] = match;
    const servedVersions = groups.get(groupName);
    if (!servedVersions) {
      if (definitionValue.optional) {
        continue;
      }
      throw new Error(
        `Required Kubernetes API group is not served: ${groupName}`
      );
    }
    if (!servedVersions.has(version)) {
      throw new Error(
        `Configured Kubernetes API version is not served: ${groupName}/${version}`
      );
    }
  }
}

export async function captureSnapshotWithKubeconfig(input) {
  const { cluster, kubeConfig, kubeconfigSha256 } = loadExplicitKubeConfig(
    input.kubeconfig,
    input.context
  );
  const allowedPaths = new Set([
    "/apis",
    ...SNAPSHOT_DEFINITIONS.map((definitionValue) =>
      namespacePath(definitionValue, input.namespace?.trim() || null)
    ),
  ]);
  const fetchImpl = requestWithKubeconfig(kubeConfig, allowedPaths);
  await validateConfiguredApiVersions(
    fetchImpl,
    cluster.server,
    input.requestTimeoutMs ?? 60_000
  );
  return captureSnapshotFromApi({
    ...input,
    baseUrl: cluster.server,
    fetchImpl,
    sourceFingerprint: clusterIdentityFingerprint(
      kubeConfig,
      input.context,
      kubeconfigSha256
    ),
  });
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  for (const candidate of [filePath, temporaryPath]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${candidate}`);
    }
  }
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
}

function ensureDirectories(outDir) {
  const snapshotDir = path.join(outDir, "snapshot-v1");
  const resourcesDir = path.join(snapshotDir, "resources");
  const snapshotExisted = existsSync(snapshotDir);
  const resourcesExisted = existsSync(resourcesDir);
  for (const directory of [snapshotDir, resourcesDir]) {
    if (!existsSync(directory)) {
      continue;
    }
    const stats = lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `Refusing to use symbolic link or non-directory snapshot path: ${directory}`
      );
    }
  }
  if (
    snapshotExisted &&
    !existsSync(path.join(snapshotDir, "snapshot-manifest.json")) &&
    readdirSync(snapshotDir).length > 0
  ) {
    throw new Error(
      `Refusing to overwrite a non-empty snapshot directory without an owned manifest: ${snapshotDir}`
    );
  }
  mkdirSync(resourcesDir, { mode: 0o700, recursive: true });
  if (!snapshotExisted) {
    chmodSync(snapshotDir, 0o700);
  }
  if (!resourcesExisted) {
    chmodSync(resourcesDir, 0o700);
  }
  return { resourcesDir, snapshotDir };
}

function namespacePath(definitionValue, namespace) {
  if (!namespace) {
    return definitionValue.path;
  }
  const lastSlash = definitionValue.path.lastIndexOf("/");
  const prefix = definitionValue.path.slice(0, lastSlash);
  const resource = definitionValue.path.slice(lastSlash + 1);
  return `${prefix}/namespaces/${encodeURIComponent(namespace)}/${resource}`;
}

function snapshotUrl(baseUrl, definitionValue, options, continueToken) {
  const url = new URL(
    namespacePath(definitionValue, options.namespace),
    baseUrl
  );
  url.searchParams.set("labelSelector", definitionValue.selector);
  url.searchParams.set("limit", String(options.pageSize));
  if (continueToken) {
    url.searchParams.set("continue", continueToken);
  }
  return url;
}

function projectedInstanceSpec(spec) {
  const appName = spec?.defaults?.app_name;
  return {
    ...(Array.isArray(spec?.categories) ? { categories: spec.categories } : {}),
    ...(typeof spec?.gitRepo === "string" ? { gitRepo: spec.gitRepo } : {}),
    ...(typeof spec?.templateType === "string"
      ? { templateType: spec.templateType }
      : {}),
    ...(typeof spec?.title === "string" ? { title: spec.title } : {}),
    ...(typeof spec?.url === "string" ? { url: spec.url } : {}),
    ...(appName && typeof appName === "object"
      ? { defaults: { app_name: { value: appName.value } } }
      : {}),
  };
}

function normalizeResource(item, definitionValue) {
  const metadata = item?.metadata ?? {};
  const displayName =
    metadata.annotations?.["cloud.sealos.io/deploy-on-sealos-displayName"];
  return {
    apiVersion: definitionValue.apiVersion,
    kind: definitionValue.kind,
    metadata: {
      annotations:
        definitionValue.role === "instance" && typeof displayName === "string"
          ? {
              "cloud.sealos.io/deploy-on-sealos-displayName": displayName,
            }
          : {},
      creationTimestamp: metadata.creationTimestamp ?? "",
      labels: metadata.labels ?? {},
      name: metadata.name ?? "",
      namespace: metadata.namespace ?? "",
      ownerReferences: metadata.ownerReferences ?? [],
      uid: metadata.uid ?? "",
    },
    role: definitionValue.role,
    ...(definitionValue.role === "instance"
      ? { spec: projectedInstanceSpec(item?.spec) }
      : {}),
    type: definitionValue.type,
  };
}

function assertMetadataOnlyResponse(body, definitionValue) {
  if (!definitionValue.metadataOnly) {
    return;
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  if (
    body?.kind !== "PartialObjectMetadataList" ||
    items.some(
      (item) =>
        item?.kind !== "PartialObjectMetadata" ||
        item?.data !== undefined ||
        item?.stringData !== undefined
    )
  ) {
    throw new Error(
      `Kubernetes metadata-only response was not honored for ${definitionValue.id}`
    );
  }
}

function assertListResponse(body, definitionValue) {
  if (
    !(body && (body.items == null || Array.isArray(body.items))) ||
    typeof body.metadata !== "object" ||
    typeof body.metadata?.resourceVersion !== "string" ||
    body.metadata.resourceVersion === ""
  ) {
    const responseShape = {
      apiVersion: body?.apiVersion ?? null,
      itemCount: Array.isArray(body?.items) ? body.items.length : null,
      kind: body?.kind ?? null,
      metadataKeys:
        body?.metadata && typeof body.metadata === "object"
          ? Object.keys(body.metadata).sort()
          : [],
      resourceVersion: body?.metadata?.resourceVersion ?? null,
    };
    throw new Error(
      `Malformed Kubernetes list response for ${definitionValue.id}: ${JSON.stringify(responseShape)}`
    );
  }
  if (
    !definitionValue.metadataOnly &&
    body.kind !== `${definitionValue.kind}List`
  ) {
    throw new Error(
      `Unexpected Kubernetes list kind for ${definitionValue.id}`
    );
  }
  assertMetadataOnlyResponse(body, definitionValue);
}

function pageResourceVersion(body, current, definitionId) {
  const value = body.metadata.resourceVersion;
  if (current !== "" && value !== current) {
    throw new Error(
      `Kubernetes resourceVersion changed between pages for ${definitionId}`
    );
  }
  return value;
}

function nextContinueToken(body, seenContinueTokens, definitionId) {
  const token = body.metadata.continue ?? "";
  if (token === "") {
    return "";
  }
  if (seenContinueTokens.has(token)) {
    throw new Error(
      `Kubernetes pagination repeated a continue token for ${definitionId}`
    );
  }
  seenContinueTokens.add(token);
  return token;
}

async function fetchPage(url, definitionValue, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await options.fetchImpl(url, {
        headers: {
          Accept: definitionValue.metadataOnly
            ? PARTIAL_METADATA_ACCEPT
            : "application/json",
        },
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      });
      if (response.status === 404) {
        return { notInstalled: true };
      }
      if (response.status === 410) {
        throw new ResourceExpiredError(
          `Kubernetes pagination expired for ${definitionValue.id}`
        );
      }
      if (!response.ok) {
        throw new KubernetesHttpError(definitionValue.id, response);
      }
      return { body: await response.json(), notInstalled: false };
    } catch (error) {
      lastError = error;
      if (
        error instanceof ResourceExpiredError ||
        (error instanceof KubernetesHttpError && !error.retryable) ||
        attempt >= options.retries
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * 2 ** attempt, 5000))
      );
    }
  }
  throw lastError;
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function finishNotInstalledResource(
  definitionValue,
  resourcesDir,
  partialPath,
  finalPath,
  pages,
  count
) {
  if (pages !== 1 || count !== 0) {
    throw new Error(
      `Kubernetes API disappeared during pagination for ${definitionValue.id}`
    );
  }
  if (!definitionValue.optional) {
    throw new Error(
      `Missing required Kubernetes API for ${definitionValue.id}`
    );
  }
  renameSync(partialPath, finalPath);
  return {
    count: 0,
    file: path.relative(path.dirname(resourcesDir), finalPath),
    id: definitionValue.id,
    pages,
    resourceVersion: "",
    sha256: await fileSha256(finalPath),
    status: "not-installed",
  };
}

async function captureDefinitionAttempt(
  baseUrl,
  definitionValue,
  resourcesDir,
  options
) {
  const finalPath = path.join(resourcesDir, `${definitionValue.id}.ndjson`);
  const partialPath = `${finalPath}.partial`;
  for (const candidate of [finalPath, partialPath]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${candidate}`);
    }
  }
  writeFileSync(partialPath, "", { encoding: "utf8", mode: 0o600 });
  chmodSync(partialPath, 0o600);

  let continueToken = "";
  let count = 0;
  let pages = 0;
  let resourceVersion = "";
  const seenContinueTokens = new Set();
  do {
    const result = await fetchPage(
      snapshotUrl(baseUrl, definitionValue, options, continueToken),
      definitionValue,
      options
    );
    pages += 1;
    if (result.notInstalled) {
      return finishNotInstalledResource(
        definitionValue,
        resourcesDir,
        partialPath,
        finalPath,
        pages,
        count
      );
    }

    const body = result.body ?? {};
    assertListResponse(body, definitionValue);
    resourceVersion = pageResourceVersion(
      body,
      resourceVersion,
      definitionValue.id
    );
    const items = Array.isArray(body.items) ? body.items : [];
    const lines = items
      .map((item) => JSON.stringify(normalizeResource(item, definitionValue)))
      .join("\n");
    if (lines !== "") {
      appendFileSync(partialPath, `${lines}\n`, "utf8");
    }
    count += items.length;
    continueToken = nextContinueToken(
      body,
      seenContinueTokens,
      definitionValue.id
    );
  } while (continueToken !== "");

  renameSync(partialPath, finalPath);
  chmodSync(finalPath, 0o600);
  return {
    count,
    file: path.relative(path.dirname(resourcesDir), finalPath),
    id: definitionValue.id,
    pages,
    resourceVersion,
    sha256: await fileSha256(finalPath),
    status: "complete",
  };
}

async function captureDefinition(
  baseUrl,
  definitionValue,
  resourcesDir,
  options
) {
  try {
    return await captureDefinitionAttempt(
      baseUrl,
      definitionValue,
      resourcesDir,
      options
    );
  } catch (error) {
    if (!(error instanceof ResourceExpiredError)) {
      throw error;
    }
    return captureDefinitionAttempt(
      baseUrl,
      definitionValue,
      resourcesDir,
      options
    );
  }
}

function initialManifest(options) {
  return {
    complete: false,
    context: options.context ?? null,
    definitionFingerprint: SNAPSHOT_DEFINITION_FINGERPRINT,
    generatedAt: new Date().toISOString(),
    kubeconfig: options.kubeconfig ?? null,
    namespace: options.namespace ?? null,
    pageSize: options.pageSize,
    resources: [],
    scope: options.namespace ? "namespace" : "cluster",
    sourceFingerprint: options.sourceFingerprint,
    tool: "brain-v1-import",
    version: SNAPSHOT_VERSION,
  };
}

function expectedResourceFile(definitionValue) {
  return path.join("resources", `${definitionValue.id}.ndjson`);
}

async function manifestResourceIsReusable(
  snapshotDir,
  definitionValue,
  resource
) {
  if (
    !resource ||
    resource.id !== definitionValue.id ||
    (resource.status !== "complete" && resource.status !== "not-installed") ||
    resource.file !== expectedResourceFile(definitionValue) ||
    typeof resource.sha256 !== "string"
  ) {
    return false;
  }
  const resourcePath = path.join(snapshotDir, resource.file);
  return (
    existsSync(resourcePath) &&
    !lstatSync(resourcePath).isSymbolicLink() &&
    (await fileSha256(resourcePath)) === resource.sha256
  );
}

async function loadResumeManifest(manifestPath, snapshotDir, options) {
  if (!existsSync(manifestPath)) {
    return null;
  }
  if (lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error("Refusing to reuse a symbolic-link snapshot manifest");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.tool !== "brain-v1-import") {
    throw new Error(
      "Refusing to reuse a snapshot not owned by brain-v1-import"
    );
  }
  const expected = initialManifest(options);
  for (const key of [
    "context",
    "definitionFingerprint",
    "kubeconfig",
    "namespace",
    "pageSize",
    "scope",
    "sourceFingerprint",
    "version",
  ]) {
    if (manifest[key] !== expected[key]) {
      throw new Error(`Snapshot resume mismatch: ${key}`);
    }
  }
  const byId = new Map(
    (manifest.resources ?? []).map((resource) => [resource.id, resource])
  );
  const reusableIds = new Set();
  for (const definitionValue of SNAPSHOT_DEFINITIONS) {
    if (
      await manifestResourceIsReusable(
        snapshotDir,
        definitionValue,
        byId.get(definitionValue.id)
      )
    ) {
      reusableIds.add(definitionValue.id);
    }
  }
  return {
    byId,
    complete:
      manifest.complete === true &&
      reusableIds.size === SNAPSHOT_DEFINITIONS.length,
    manifest,
    reusableIds,
  };
}

export async function captureSnapshotFromApi(input) {
  const options = {
    context: input.context ?? null,
    fetchImpl: input.fetchImpl ?? fetch,
    kubeconfig: input.kubeconfig ?? null,
    namespace: input.namespace?.trim() || null,
    pageSize: input.pageSize ?? 200,
    requestTimeoutMs: input.requestTimeoutMs ?? 60_000,
    retries: input.retries ?? 3,
    sourceFingerprint:
      input.sourceFingerprint ?? sha256Text(String(input.baseUrl)),
  };
  const { resourcesDir, snapshotDir } = ensureDirectories(input.outDir);
  const manifestPath = path.join(snapshotDir, "snapshot-manifest.json");
  const resumed = await loadResumeManifest(manifestPath, snapshotDir, options);
  if (resumed?.complete) {
    return { manifest: resumed.manifest, manifestPath, snapshotDir };
  }
  const manifest = {
    ...(resumed?.manifest ?? initialManifest(options)),
    complete: false,
    resources: [],
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(manifestPath, manifest);

  for (const definitionValue of SNAPSHOT_DEFINITIONS) {
    const existing = resumed?.byId.get(definitionValue.id);
    if (resumed?.reusableIds.has(definitionValue.id)) {
      manifest.resources.push(existing);
      atomicWriteJson(manifestPath, manifest);
      continue;
    }
    try {
      const resource = await captureDefinition(
        input.baseUrl,
        definitionValue,
        resourcesDir,
        options
      );
      manifest.resources.push(resource);
      atomicWriteJson(manifestPath, manifest);
    } catch (error) {
      manifest.resources.push({
        error: error instanceof Error ? error.message : String(error),
        id: definitionValue.id,
        status: "failed",
      });
      atomicWriteJson(manifestPath, manifest);
      throw error;
    }
  }

  manifest.complete = true;
  manifest.completedAt = new Date().toISOString();
  atomicWriteJson(manifestPath, manifest);
  return { manifest, manifestPath, snapshotDir };
}

export function snapshotExists(outDir) {
  return existsSync(path.join(outDir, "snapshot-v1", "snapshot-manifest.json"));
}

async function verifyManifest(snapshotDir) {
  const manifestPath = path.join(snapshotDir, "snapshot-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.version !== SNAPSHOT_VERSION ||
    manifest.complete !== true ||
    manifest.tool !== "brain-v1-import" ||
    manifest.definitionFingerprint !== SNAPSHOT_DEFINITION_FINGERPRINT ||
    !SHA256_PATTERN.test(manifest.sourceFingerprint ?? "")
  ) {
    throw new Error("Snapshot is incomplete or unsupported");
  }
  if (lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error("Refusing to read a symbolic-link snapshot manifest");
  }
  const resources = manifest.resources ?? [];
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  if (
    resources.length !== SNAPSHOT_DEFINITIONS.length ||
    byId.size !== SNAPSHOT_DEFINITIONS.length
  ) {
    throw new Error("Snapshot resource set is incomplete or duplicated");
  }
  for (const definitionValue of SNAPSHOT_DEFINITIONS) {
    const resource = byId.get(definitionValue.id);
    if (resource?.file !== expectedResourceFile(definitionValue)) {
      throw new Error(
        `Snapshot has unexpected snapshot resource path: ${definitionValue.id}`
      );
    }
    if (resource.status !== "complete" && resource.status !== "not-installed") {
      throw new Error(`Snapshot resource is incomplete: ${resource.id}`);
    }
    const resourcePath = path.join(snapshotDir, resource.file);
    if (
      !existsSync(resourcePath) ||
      lstatSync(resourcePath).isSymbolicLink() ||
      (await fileSha256(resourcePath)) !== resource.sha256
    ) {
      throw new Error(`Snapshot checksum mismatch: ${resource.id}`);
    }
  }
  return manifest;
}

function createIndexSchema(db) {
  db.exec("PRAGMA synchronous = FULL");
  db.exec(`
    create table resources (
      source_id text not null,
      role text not null,
      type text not null,
      api_version text not null,
      kind text not null,
      namespace text not null,
      name text not null,
      uid text not null,
      creation_timestamp text not null,
      deploy_on_sealos text,
      app_deploy_manager text,
      resource_json text not null,
      primary key (source_id, namespace, name, uid)
    );
    create index resources_project_membership
      on resources (role, namespace, deploy_on_sealos);
    create index resources_app_membership
      on resources (role, namespace, app_deploy_manager);
  `);
}

async function insertSnapshotFile(db, sourceId, filePath) {
  const insert = db.prepare(`
    insert into resources (
      source_id, role, type, api_version, kind, namespace, name, uid,
      creation_timestamp, deploy_on_sealos, app_deploy_manager, resource_json
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: createReadStream(filePath, { encoding: "utf8" }),
  });
  for await (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const resource = JSON.parse(line);
    const metadata = resource.metadata ?? {};
    const labels = metadata.labels ?? {};
    insert.run(
      sourceId,
      resource.role ?? "",
      resource.type ?? "",
      resource.apiVersion ?? "",
      resource.kind ?? "",
      metadata.namespace ?? "",
      metadata.name ?? "",
      metadata.uid ?? "",
      metadata.creationTimestamp ?? "",
      labels[LEGACY_LABELS.deployOnSealos] ?? null,
      labels[LEGACY_LABELS.appDeployManager] ?? null,
      JSON.stringify(resource)
    );
  }
  insert.finalize();
}

async function buildSnapshotIndex(snapshotDir, manifest) {
  const indexPath = path.join(snapshotDir, "index.sqlite");
  const partialPath = `${indexPath}.partial`;
  for (const candidate of [indexPath, partialPath]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${candidate}`);
    }
  }
  if (existsSync(partialPath)) {
    unlinkSync(partialPath);
  }
  const db = new Database(partialPath, { create: true, strict: true });
  try {
    createIndexSchema(db);
    db.exec("begin immediate");
    try {
      for (const resource of manifest.resources) {
        await insertSnapshotFile(
          db,
          resource.id,
          path.join(snapshotDir, resource.file)
        );
      }
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
    const integrity = db.query("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error("Snapshot index integrity check failed");
    }
  } finally {
    db.close(false);
  }
  renameSync(partialPath, indexPath);
  chmodSync(indexPath, 0o600);
  return indexPath;
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

function resourceRef(resource) {
  return {
    apiVersion: resource.apiVersion ?? "",
    creationTimestamp: resource.metadata?.creationTimestamp ?? "",
    kind: resource.kind ?? "",
    name: resourceName(resource),
    namespace: resource.metadata?.namespace ?? "",
    type: resource.type ?? "",
    uid: resource.metadata?.uid ?? "",
  };
}

export function deterministicProjectId(namespace, instance) {
  const source = `${namespace}\0${instance.metadata?.uid ?? resourceName(instance)}`;
  const hex = createHash("sha256")
    .update(`brain-v1-import\0${source}`)
    .digest("hex");
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) % 4) + 8).toString(16);
  const id = chars.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function legacyDisplayName(instance) {
  return (
    annotationsOf(instance)["cloud.sealos.io/deploy-on-sealos-displayName"] ||
    instance.spec?.title ||
    instance.spec?.defaults?.app_name?.value ||
    resourceName(instance)
  );
}

function isBrainManaged(resource) {
  const labels = labelsOf(resource);
  return (
    labels["brain.io/managed-by"] === "brain" ||
    typeof labels["brain.io/project-id"] === "string"
  );
}

function isLegacyCandidate(instance) {
  const name = resourceName(instance);
  return (
    name !== "" &&
    !isBrainManaged(instance) &&
    labelsOf(instance)[LEGACY_LABELS.deployOnSealos] === name
  );
}

function rowResource(row) {
  return JSON.parse(row.resource_json);
}

function dedupeResources(resources) {
  const seen = new Set();
  return resources.filter((resource) => {
    const ref = resourceRef(resource);
    const key = `${ref.type}\0${ref.namespace}\0${ref.name}\0${ref.uid}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function classifyProject(entry) {
  const hasAp = entry.members.some(
    (member) =>
      (member.resource.kind === "Deployment" ||
        member.resource.kind === "StatefulSet") &&
      typeof member.labels[LEGACY_LABELS.appDeployManager] === "string" &&
      member.labels[LEGACY_LABELS.appDeployManager] !== ""
  );
  const hasDb = entry.members.some(
    (member) => member.resource.kind === "Cluster"
  );
  const hasBucket = entry.members.some(
    (member) => member.resource.kind === "ObjectStorageBucket"
  );
  const hasOtherUnsupportedMember = entry.members.some((member) => {
    if (member.resource.kind === "App" || member.resource.kind === "Cluster") {
      return false;
    }
    if (
      member.resource.kind === "Deployment" ||
      member.resource.kind === "StatefulSet"
    ) {
      return !member.labels[LEGACY_LABELS.appDeployManager];
    }
    return member.resource.kind !== "ObjectStorageBucket";
  });
  if (hasAp || hasDb) {
    let reason = "v2-members";
    if (hasBucket) {
      reason = "v2-members-with-object-storage-review";
    } else if (hasOtherUnsupportedMember) {
      reason = "v2-members-with-unsupported-review";
    }
    return { decision: "eligible", reason };
  }
  if (entry.members.length === 0) {
    return { decision: "excluded", reason: "no-v2-members" };
  }
  if (
    entry.members.length === 1 &&
    entry.members[0]?.resource.kind === "App" &&
    entry.supportResources.length === 0
  ) {
    return { decision: "excluded", reason: "app-crd-only" };
  }
  return { decision: "manual-review", reason: "unsupported-member-shape" };
}

function reportEntry(entry, classification) {
  const classificationHash = sha256Text(
    JSON.stringify({
      decision: classification.decision,
      legacyInstance: entry.legacyInstance.resource,
      members: entry.members.map((member) => ({
        appDeployManager: member.labels[LEGACY_LABELS.appDeployManager] ?? null,
        deployOnSealos: member.labels[LEGACY_LABELS.deployOnSealos] ?? null,
        resource: member.resource,
      })),
      projectId: entry.projectId,
      reason: classification.reason,
      supportResources: entry.supportResources.map(
        (resource) => resource.resource
      ),
    })
  );
  return {
    classificationHash,
    displayName: entry.displayName,
    legacyInstance: entry.legacyInstance.resource,
    memberKinds: [
      ...new Set(entry.members.map((member) => member.resource.kind)),
    ].sort(),
    projectId: entry.projectId,
    reason: classification.reason,
  };
}

function loadClassificationDecisions(decisionsPath) {
  if (!decisionsPath) {
    return new Map();
  }
  const value = JSON.parse(readFileSync(decisionsPath, "utf8"));
  if (value.schema !== DECISIONS_SCHEMA || value.version !== 1) {
    throw new Error(
      `Unsupported classification decisions schema/version: ${value.schema ?? "missing"}/${value.version}`
    );
  }
  const decisions = new Map();
  for (const entry of value.decisions ?? []) {
    if (
      typeof entry.projectId !== "string" ||
      typeof entry.classificationHash !== "string" ||
      (entry.decision !== "include" && entry.decision !== "exclude")
    ) {
      throw new Error("Invalid classification decision entry");
    }
    if (decisions.has(entry.projectId)) {
      throw new Error(`Duplicate classification decision: ${entry.projectId}`);
    }
    decisions.set(entry.projectId, entry);
  }
  return decisions;
}

function inventoryProjectFromInstance(db, instance) {
  const namespace = instance.metadata?.namespace ?? "";
  const instanceName = resourceName(instance);
  const memberRows = db
    .query(
      "select resource_json from resources where role = 'member' and namespace = ? and deploy_on_sealos = ? order by type, name, uid, source_id"
    )
    .all(namespace, instanceName);
  const memberResources = memberRows.map(rowResource);
  const members = memberResources.map((resource) => ({
    labels: labelsOf(resource),
    resource: resourceRef(resource),
  }));
  const appNames = [
    ...new Set(
      members
        .map((member) => member.labels[LEGACY_LABELS.appDeployManager])
        .filter((value) => typeof value === "string" && value !== "")
    ),
  ];
  const supportResources = dedupeResources(
    appNames.flatMap((appName) =>
      db
        .query(
          "select resource_json from resources where role = 'support' and namespace = ? and app_deploy_manager = ? order by type, name, uid, source_id"
        )
        .all(namespace, appName)
        .map(rowResource)
    )
  ).map((resource) => ({
    labels: labelsOf(resource),
    reason: `app-manager:${labelsOf(resource)[LEGACY_LABELS.appDeployManager]}`,
    resource: resourceRef(resource),
  }));
  return {
    displayName: legacyDisplayName(instance),
    legacyInstance: {
      labels: labelsOf(instance),
      resource: resourceRef(instance),
    },
    members,
    projectId: deterministicProjectId(namespace, instance),
    supportResources,
  };
}

function inventoryFromEntries(manifest, entries, skippedInstances, report) {
  return {
    classification: {
      complete: report.manualReview.length === 0,
      unresolvedCount: report.manualReview.length,
    },
    context: manifest.context ?? null,
    errors: [],
    excludedProjects: report.excluded,
    generatedAt: new Date().toISOString(),
    kubeconfig: manifest.kubeconfig ?? null,
    manualReviewProjects: report.manualReview,
    namespace: manifest.namespace ?? null,
    projects: entries,
    schema: INVENTORY_SCHEMA,
    scope: manifest.scope,
    skippedInstances,
    sourceFingerprint: manifest.sourceFingerprint,
    summary: {
      candidateProjects: entries.length,
      errors: 0,
      excludedProjects: report.excluded.length,
      manualReviewProjects: report.manualReview.length,
      memberResources: entries.reduce(
        (sum, project) => sum + project.members.length,
        0
      ),
      skippedInstances: skippedInstances.length,
      supportResources: entries.reduce(
        (sum, project) => sum + project.supportResources.length,
        0
      ),
      totalInstances:
        entries.length +
        report.excluded.length +
        report.manualReview.length +
        skippedInstances.length,
    },
    source: "snapshot-v1",
    version: INVENTORY_VERSION,
  };
}

function distributeClassifiedEntry(entry, decisions, collections) {
  const classification = classifyProject(entry);
  const report = reportEntry(entry, classification);
  const decision = decisions.get(entry.projectId);
  if (decision) {
    if (decision.classificationHash !== report.classificationHash) {
      throw new Error(
        `Stale classification decision for project: ${entry.projectId}`
      );
    }
    collections.usedDecisionIds.add(entry.projectId);
    const resolved = {
      ...report,
      decision: decision.decision,
      note: typeof decision.note === "string" ? decision.note : "",
    };
    collections.resolvedDecisions.push(resolved);
    if (decision.decision === "exclude") {
      collections.excluded.push({
        ...resolved,
        reason: `user-excluded:${classification.reason}`,
      });
      return;
    }
    collections.eligible.push(entry);
    collections.eligibleProjects.push(resolved);
    if (classification.reason !== "v2-members") {
      collections.eligibleWithReview.push(resolved);
    }
    return;
  }
  if (classification.decision === "eligible") {
    collections.eligible.push(entry);
    collections.eligibleProjects.push(report);
    if (classification.reason !== "v2-members") {
      collections.eligibleWithReview.push(report);
    }
    return;
  }
  if (classification.decision === "excluded") {
    collections.excluded.push(report);
    return;
  }
  collections.manualReview.push(report);
}

export async function buildInventoryFromSnapshot(input) {
  const manifest = await verifyManifest(input.snapshotDir);
  const decisions = loadClassificationDecisions(input.decisionsPath);
  const usedDecisionIds = new Set();
  const indexPath = await buildSnapshotIndex(input.snapshotDir, manifest);
  const db = new Database(indexPath, { readonly: true, strict: true });
  try {
    const instanceRows = db
      .query(
        "select resource_json from resources where role = 'instance' order by namespace, creation_timestamp, name, uid"
      )
      .all();
    const instances = instanceRows.map(rowResource);
    const eligible = [];
    const eligibleProjects = [];
    const eligibleWithReview = [];
    const excluded = [];
    const manualReview = [];
    const resolvedDecisions = [];
    const skippedInstances = [];
    const collections = {
      eligible,
      eligibleProjects,
      eligibleWithReview,
      excluded,
      manualReview,
      resolvedDecisions,
      usedDecisionIds,
    };
    for (const instance of instances) {
      if (!isLegacyCandidate(instance)) {
        skippedInstances.push({
          reason: isBrainManaged(instance)
            ? "already-brain-managed"
            : "not-a-legacy-project-candidate",
          resource: resourceRef(instance),
        });
        continue;
      }
      const entry = inventoryProjectFromInstance(db, instance);
      distributeClassifiedEntry(entry, decisions, collections);
    }
    const unusedDecisionIds = [...decisions.keys()].filter(
      (projectId) => !usedDecisionIds.has(projectId)
    );
    if (unusedDecisionIds.length > 0) {
      throw new Error(
        `Classification decisions do not match unresolved projects: ${unusedDecisionIds.join(", ")}`
      );
    }
    const report = {
      excluded,
      eligibleProjects,
      eligibleWithReview,
      generatedAt: new Date().toISOString(),
      manualReview,
      resolvedDecisions,
      summary: {
        eligible: eligible.length,
        eligibleWithReview: eligibleWithReview.length,
        excluded: excluded.length,
        manualReview: manualReview.length,
        resolvedDecisions: resolvedDecisions.length,
        totalCandidates:
          eligible.length + excluded.length + manualReview.length,
      },
      schema: "brain-v1-classification/v2",
      version: INVENTORY_VERSION,
    };
    const inventory = inventoryFromEntries(
      manifest,
      eligible,
      skippedInstances,
      report
    );
    const inventoryPath = path.join(input.outDir, "inventory.json");
    const reportPath = path.join(input.outDir, "classification-report.json");
    atomicWriteJson(inventoryPath, inventory);
    atomicWriteJson(reportPath, report);
    return { indexPath, inventory, inventoryPath, report, reportPath };
  } finally {
    db.close(false);
  }
}
