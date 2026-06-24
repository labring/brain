import { API_ROUTES } from "@workspace/api/constants";
import YAML from "yaml";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
  templateDeploymentExtraLabels,
} from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "./kubeconfig-header";
import {
  addTemplateInstanceOwnerReferences,
  generateTemplateInstanceOwnerReference,
  type RenderedTemplateDeployment,
  type TemplateK8sObject,
} from "./template-renderer";

export interface AppliedTemplateDeploymentResource {
  name: string;
  resourceType: string;
  uid: string;
}

export interface AppliedTemplateDeployment {
  instanceName: string;
  resources: AppliedTemplateDeploymentResource[];
}

const BRAIN_DEPLOYMENT_LABEL_KEYS = [
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
];
const GHCR_HOST = "ghcr.io";
const GHCR_PULL_SECRET_SUFFIX = "-ghcr-pull";
const KUBERNETES_NAME_MAX_LENGTH = 63;
const NGINX_SSL_REDIRECT_ANNOTATION =
  "nginx.ingress.kubernetes.io/ssl-redirect";
const NGINX_CONFIGURATION_SNIPPET_ANNOTATION =
  "nginx.ingress.kubernetes.io/configuration-snippet";
const FORCE_HTTPS_FORWARDED_PROTO_SNIPPET =
  "proxy_set_header X-Forwarded-Proto https;";

function apiBaseUrl(): string {
  const base = process.env.API_URL?.trim();
  if (!base) {
    throw new Error("API_URL is not configured.");
  }
  return base;
}

function apiUrl(path: string, query?: Record<string, string>) {
  const url = new URL(path, apiBaseUrl());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function authHeaders(encodedKubeconfig: string) {
  return {
    Authorization: kubeconfigBearerHeader(encodedKubeconfig),
    "Content-Type": "application/json",
  };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseError(body: unknown, fallback: string): string {
  if (typeof body === "string" && body !== "") {
    return body;
  }
  if (body != null && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    const error = (body as { error?: unknown }).error;
    if (typeof message === "string" && message !== "") {
      return message;
    }
    if (typeof error === "string" && error !== "") {
      return error;
    }
  }
  return fallback;
}

async function applyYaml(input: { encodedKubeconfig: string; yaml: string }) {
  const response = await fetch(apiUrl(API_ROUTES.k8s.apply), {
    body: JSON.stringify({ yaml: input.yaml }),
    headers: authHeaders(input.encodedKubeconfig),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      responseError(await readBody(response), "Failed to apply template YAML.")
    );
  }
}

async function getInstance(input: {
  encodedKubeconfig: string;
  instanceName: string;
  namespace: string;
}): Promise<TemplateK8sObject> {
  const response = await fetch(
    apiUrl(API_ROUTES.k8s.get, {
      kind: "instances",
      name: input.instanceName,
      namespace: input.namespace,
    }),
    {
      headers: authHeaders(input.encodedKubeconfig),
      method: "GET",
    }
  );
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(responseError(body, "Failed to read template Instance."));
  }
  return body as TemplateK8sObject;
}

function resourceSummary(
  resource: TemplateK8sObject
): AppliedTemplateDeploymentResource {
  return {
    name: resource.metadata?.name ?? "",
    resourceType: resource.kind?.toLowerCase() ?? "",
    uid: resource.metadata?.uid ?? "",
  };
}

function cloneResource(resource: TemplateK8sObject): TemplateK8sObject {
  return JSON.parse(JSON.stringify(resource)) as TemplateK8sObject;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asMutableArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => asRecord(item) !== undefined
      )
    : [];
}

function ensureLabels(resource: TemplateK8sObject): Record<string, string> {
  resource.metadata ??= {};
  resource.metadata.labels ??= {};
  return resource.metadata.labels;
}

function ensureAnnotations(
  resource: TemplateK8sObject
): Record<string, string> {
  resource.metadata ??= {};
  resource.metadata.annotations ??= {};
  return resource.metadata.annotations as Record<string, string>;
}

function ensureBrainDeploymentLabels(input: {
  labels: Record<string, string>;
  instanceName: string;
  projectId: string;
  templateName: string;
}) {
  const expected = templateDeploymentExtraLabels({
    instanceName: input.instanceName,
    projectId: input.projectId,
    templateName: input.templateName,
  });
  for (const key of BRAIN_DEPLOYMENT_LABEL_KEYS) {
    input.labels[key] = expected[key] ?? "";
  }
}

function normalizeBrainDeploymentLabels(input: {
  resource: TemplateK8sObject;
  instanceName: string;
  projectId: string;
  templateName: string;
}) {
  ensureBrainDeploymentLabels({
    instanceName: input.instanceName,
    labels: ensureLabels(input.resource),
    projectId: input.projectId,
    templateName: input.templateName,
  });

  const podTemplateMeta = asRecord(
    asRecord(asRecord(input.resource.spec)?.template)?.metadata
  );
  const podTemplateLabels = asRecord(podTemplateMeta?.labels);
  if (podTemplateLabels != null) {
    ensureBrainDeploymentLabels({
      instanceName: input.instanceName,
      labels: podTemplateLabels as Record<string, string>,
      projectId: input.projectId,
      templateName: input.templateName,
    });
  }

  const volumeClaimTemplates = asRecord(
    input.resource.spec
  )?.volumeClaimTemplates;
  if (Array.isArray(volumeClaimTemplates)) {
    for (const claim of volumeClaimTemplates) {
      const claimMeta = asRecord(claim)?.metadata;
      if (claimMeta == null) {
        continue;
      }
      const metadata = claimMeta as Record<string, unknown>;
      metadata.labels ??= {};
      ensureBrainDeploymentLabels({
        instanceName: input.instanceName,
        labels: metadata.labels as Record<string, string>,
        projectId: input.projectId,
        templateName: input.templateName,
      });
    }
  }
}

function normalizeHttpOnlyIngress(resource: TemplateK8sObject) {
  if (resource.kind !== "Ingress") {
    return;
  }
  const spec = asRecord(resource.spec);
  if (Array.isArray(spec?.tls) && spec.tls.length > 0) {
    return;
  }
  const annotations = ensureAnnotations(resource);
  annotations[NGINX_SSL_REDIRECT_ANNOTATION] = "false";
  if (
    annotations[NGINX_CONFIGURATION_SNIPPET_ANNOTATION]?.trim() ===
    FORCE_HTTPS_FORWARDED_PROTO_SNIPPET
  ) {
    delete annotations[NGINX_CONFIGURATION_SNIPPET_ANNOTATION];
  }
}

function normalizeRenderedTemplateDeployment(input: {
  instanceName: string;
  projectId: string;
  rendered: RenderedTemplateDeployment;
  templateName: string;
}): RenderedTemplateDeployment {
  const resources = input.rendered.resources.map((resource) => {
    const copy = cloneResource(resource);
    normalizeBrainDeploymentLabels({
      instanceName: input.instanceName,
      projectId: input.projectId,
      resource: copy,
      templateName: input.templateName,
    });
    normalizeHttpOnlyIngress(copy);
    return copy;
  });
  const instanceResource = resources.find(
    (resource) =>
      resource.kind === "Instance" && resource.apiVersion === "app.sealos.io/v1"
  );
  return {
    ...input.rendered,
    dependentYamls: resources
      .filter((resource) => resource !== instanceResource)
      .map((resource) => YAML.stringify(resource)),
    instanceYaml:
      instanceResource == null
        ? input.rendered.instanceYaml
        : YAML.stringify(instanceResource),
    resources,
  };
}

function workloadPodSpec(
  resource: TemplateK8sObject
): Record<string, unknown> | undefined {
  if (resource.kind !== "Deployment" && resource.kind !== "StatefulSet") {
    return undefined;
  }
  const spec = asRecord(resource.spec);
  const template = asRecord(spec?.template);
  const templateSpec = asRecord(template?.spec);
  return templateSpec;
}

function workloadImages(resource: TemplateK8sObject): string[] {
  const podSpec = workloadPodSpec(resource);
  if (podSpec == null) {
    return [];
  }
  return [
    ...asMutableArray(podSpec.containers),
    ...asMutableArray(podSpec.initContainers),
  ].flatMap((container) =>
    typeof container.image === "string" ? [container.image] : []
  );
}

function imageMatchesBuild(input: {
  buildDigest?: string | null;
  buildImage?: string | null;
  image: string;
}): boolean {
  const buildImage = input.buildImage?.trim();
  const buildDigest = input.buildDigest?.trim();
  return (
    (buildImage != null && buildImage !== "" && input.image === buildImage) ||
    (buildDigest != null &&
      buildDigest !== "" &&
      input.image.includes(`@${buildDigest}`))
  );
}

function ghcrImages(resource: TemplateK8sObject): string[] {
  return workloadImages(resource).filter(
    (image) => image === GHCR_HOST || image.startsWith(`${GHCR_HOST}/`)
  );
}

function matchingGhcrBuildImages(input: {
  buildDigest?: string | null;
  buildImage?: string | null;
  resource: TemplateK8sObject;
}): string[] {
  return ghcrImages(input.resource).filter((image) =>
    imageMatchesBuild({
      buildDigest: input.buildDigest,
      buildImage: input.buildImage,
      image,
    })
  );
}

function appendImagePullSecret(
  resource: TemplateK8sObject,
  secretName: string
) {
  const podSpec = workloadPodSpec(resource);
  if (podSpec == null) {
    return;
  }
  const existing = Array.isArray(podSpec.imagePullSecrets)
    ? podSpec.imagePullSecrets.filter(
        (item): item is Record<string, unknown> => asRecord(item) !== undefined
      )
    : [];
  if (existing.some((item) => item.name === secretName)) {
    podSpec.imagePullSecrets = existing;
    return;
  }
  podSpec.imagePullSecrets = [...existing, { name: secretName }];
}

function dockerConfigJsonSecret(input: {
  githubToken: string;
  instanceName: string;
  projectId: string;
  templateName: string;
}): TemplateK8sObject {
  const auth = Buffer.from(`x-access-token:${input.githubToken}`).toString(
    "base64"
  );
  const dockerConfigJson = Buffer.from(
    JSON.stringify({
      auths: {
        [GHCR_HOST]: { auth },
      },
    })
  ).toString("base64");
  const secret: TemplateK8sObject = {
    apiVersion: "v1",
    data: {
      ".dockerconfigjson": dockerConfigJson,
    },
    kind: "Secret",
    metadata: {
      name: ghcrPullSecretName(input.instanceName),
    },
    type: "kubernetes.io/dockerconfigjson",
  };
  normalizeBrainDeploymentLabels({
    instanceName: input.instanceName,
    projectId: input.projectId,
    resource: secret,
    templateName: input.templateName,
  });
  return secret;
}

function ghcrPullSecretName(instanceName: string): string {
  const maxPrefixLength =
    KUBERNETES_NAME_MAX_LENGTH - GHCR_PULL_SECRET_SUFFIX.length;
  const prefix = instanceName.slice(0, maxPrefixLength).replace(/-+$/g, "");
  return `${prefix}${GHCR_PULL_SECRET_SUFFIX}`;
}

function addGhcrPullSecret(input: {
  buildDigest?: string | null;
  buildImage?: string | null;
  githubToken?: string;
  instanceName: string;
  projectId: string;
  resources: TemplateK8sObject[];
  templateName: string;
}): TemplateK8sObject[] {
  const githubToken = input.githubToken?.trim();
  if (!githubToken) {
    return input.resources;
  }
  for (const resource of input.resources) {
    const images = ghcrImages(resource);
    const matchingImages = matchingGhcrBuildImages({
      buildDigest: input.buildDigest,
      buildImage: input.buildImage,
      resource,
    });
    if (matchingImages.length > 0 && matchingImages.length !== images.length) {
      throw new Error(
        "GHCR pull secret can only be attached when every GHCR workload image matches the build result."
      );
    }
  }
  const ghcrWorkloads = input.resources.filter(
    (resource) =>
      matchingGhcrBuildImages({
        buildDigest: input.buildDigest,
        buildImage: input.buildImage,
        resource,
      }).length > 0
  );
  if (ghcrWorkloads.length === 0) {
    return input.resources;
  }
  const secret = dockerConfigJsonSecret({
    githubToken,
    instanceName: input.instanceName,
    projectId: input.projectId,
    templateName: input.templateName,
  });
  for (const workload of ghcrWorkloads) {
    appendImagePullSecret(workload, secret.metadata?.name ?? "");
  }
  const resources = input.resources.filter(
    (resource) =>
      !(
        resource.kind === "Secret" &&
        resource.metadata?.name === secret.metadata?.name
      )
  );
  const firstWorkloadIndex = resources.findIndex(
    (resource) =>
      matchingGhcrBuildImages({
        buildDigest: input.buildDigest,
        buildImage: input.buildImage,
        resource,
      }).length > 0
  );
  if (firstWorkloadIndex === -1) {
    return resources;
  }
  return [
    ...resources.slice(0, firstWorkloadIndex),
    secret,
    ...resources.slice(firstWorkloadIndex),
  ];
}

export async function applyRenderedTemplateDeployment(input: {
  encodedKubeconfig: string;
  namespace: string;
  projectId: string;
  registryAuth?: {
    buildDigest?: string | null;
    buildImage?: string | null;
    githubToken?: string;
  };
  rendered: RenderedTemplateDeployment;
  templateName: string;
}): Promise<AppliedTemplateDeployment> {
  const normalized = normalizeRenderedTemplateDeployment({
    instanceName: input.rendered.instanceName,
    projectId: input.projectId,
    rendered: input.rendered,
    templateName: input.templateName,
  });
  const applyResources = addGhcrPullSecret({
    buildDigest: input.registryAuth?.buildDigest,
    buildImage: input.registryAuth?.buildImage,
    githubToken: input.registryAuth?.githubToken,
    instanceName: normalized.instanceName,
    projectId: input.projectId,
    resources: normalized.resources,
    templateName: input.templateName,
  });
  const instanceResource = applyResources.find(
    (resource) =>
      resource.kind === "Instance" && resource.apiVersion === "app.sealos.io/v1"
  );
  await applyYaml({
    encodedKubeconfig: input.encodedKubeconfig,
    yaml:
      instanceResource == null
        ? normalized.instanceYaml
        : YAML.stringify(instanceResource),
  });
  const instance = await getInstance({
    encodedKubeconfig: input.encodedKubeconfig,
    instanceName: normalized.instanceName,
    namespace: input.namespace,
  });
  const instanceUid = instance.metadata?.uid ?? "";
  if (!instanceUid) {
    throw new Error("Template Instance UID is empty after apply.");
  }
  const ownerReference = generateTemplateInstanceOwnerReference(
    normalized.instanceName,
    instanceUid
  );
  const dependents = addTemplateInstanceOwnerReferences(
    applyResources.filter(
      (resource) =>
        !(
          resource.kind === "Instance" &&
          resource.apiVersion === "app.sealos.io/v1"
        )
    ),
    ownerReference
  );
  if (dependents.length > 0) {
    await applyYaml({
      encodedKubeconfig: input.encodedKubeconfig,
      yaml: dependents
        .map((resource) => YAML.stringify(resource))
        .join("---\n"),
    });
  }
  return {
    instanceName: input.rendered.instanceName,
    resources: [instance, ...dependents].map(resourceSummary),
  };
}
