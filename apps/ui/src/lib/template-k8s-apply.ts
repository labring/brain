import { API_ROUTES } from "@workspace/api/constants";
import YAML from "yaml";
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

export async function applyRenderedTemplateDeployment(input: {
  encodedKubeconfig: string;
  namespace: string;
  rendered: RenderedTemplateDeployment;
}): Promise<AppliedTemplateDeployment> {
  await applyYaml({
    encodedKubeconfig: input.encodedKubeconfig,
    yaml: input.rendered.instanceYaml,
  });
  const instance = await getInstance({
    encodedKubeconfig: input.encodedKubeconfig,
    instanceName: input.rendered.instanceName,
    namespace: input.namespace,
  });
  const instanceUid = instance.metadata?.uid ?? "";
  if (!instanceUid) {
    throw new Error("Template Instance UID is empty after apply.");
  }
  const ownerReference = generateTemplateInstanceOwnerReference(
    input.rendered.instanceName,
    instanceUid
  );
  const dependents = addTemplateInstanceOwnerReferences(
    input.rendered.resources.filter(
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
