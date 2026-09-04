import "server-only";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import type { TemplateDeploymentResourceSummary } from "@/features/deploy/template-provider-core";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import { templatePublicAccessCardsFromObservedIngresses } from "./direct-timeline";
import type { DeploymentResultResourceCard } from "./timeline";

const TEMPLATE_PROVIDER_INGRESS_RESOURCE_TYPES = new Set([
  "ingress",
  "ingresses",
]);
const TEMPLATE_PROVIDER_INGRESS_POLL_MS = 5000;

function templateProviderIngressNames(
  resources: readonly TemplateDeploymentResourceSummary[]
): string[] {
  const names = new Set<string>();
  for (const resource of resources) {
    const name = resource.name.trim();
    if (
      name !== "" &&
      TEMPLATE_PROVIDER_INGRESS_RESOURCE_TYPES.has(
        resource.resourceType.trim().toLowerCase()
      )
    ) {
      names.add(name);
    }
  }
  return [...names];
}

async function fetchTemplateProviderIngress(input: {
  kubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  return await fetcher({
    base: ApiUrl(),
    header: {
      Authorization: kubeconfigBearerHeader(input.kubeconfig),
    },
    method: "GET",
    path: API_ROUTES.k8s.get,
    query: {
      kind: "ingresses",
      name: input.name,
      namespace: input.namespace,
    },
    signal: input.signal,
  });
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Template Ingress discovery was aborted");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Template Ingress discovery was aborted")
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The template provider returns only resource identities, not rendered YAML.
 * Read each declared Ingress back from Kubernetes so the Timeline creates
 * canonical AccessEndpoint cards from host and TLS facts that actually landed
 * instead of guessing an address.
 */
export async function templateProviderPublicAccessCards(input: {
  kubeconfig: string;
  namespace: string;
  pollIntervalMs?: number;
  resources: readonly TemplateDeploymentResourceSummary[];
  signal?: AbortSignal;
}): Promise<DeploymentResultResourceCard[]> {
  const names = templateProviderIngressNames(input.resources);
  while (true) {
    try {
      const ingresses = await Promise.all(
        names.map((name) =>
          fetchTemplateProviderIngress({
            kubeconfig: input.kubeconfig,
            name,
            namespace: input.namespace,
            signal: input.signal,
          })
        )
      );
      return templatePublicAccessCardsFromObservedIngresses({
        ingresses,
        namespace: input.namespace,
      });
    } catch (error) {
      if (input.signal == null) {
        throw error;
      }
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : error;
      }
      await abortableDelay(
        input.pollIntervalMs ?? TEMPLATE_PROVIDER_INGRESS_POLL_MS,
        input.signal
      );
    }
  }
}
