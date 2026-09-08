import "server-only";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import {
  resolveTemplateEntryUrls,
  type TemplateDeclaredEntries,
  type TemplateEntryUrls,
  templateAppUrlFromDocs,
  templateDeclaredEntries,
  templateEntryOpenPort,
  templateIngressHostsFromDocs,
  templateInstanceDefaults,
} from "@/features/deploy/template-entries";
import {
  getTemplateSource,
  type TemplateDeploymentResourceSummary,
} from "@/features/deploy/template-provider-core";
import { renderTemplateEntryExpressions } from "@/features/deploy/template-renderer";
import { BRAIN_DEFAULT_OPEN_PORT_ANNOTATION } from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";

const INGRESS_RESOURCE_TYPES = new Set(["ingress", "ingresses"]);
const SERVICE_RESOURCE_TYPES = new Set(["service", "services"]);
const APP_RESOURCE_TYPES = new Set(["app", "apps"]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resourceNames(
  resources: readonly TemplateDeploymentResourceSummary[],
  types: ReadonlySet<string>
): string[] {
  const names = new Set<string>();
  for (const resource of resources) {
    const name = resource.name.trim();
    if (name !== "" && types.has(resource.resourceType.trim().toLowerCase())) {
      names.add(name);
    }
  }
  return [...names];
}

async function getObject(input: {
  kind: string;
  kubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown> | null> {
  try {
    return objectValue(
      await fetcher({
        base: ApiUrl(),
        header: { Authorization: kubeconfigBearerHeader(input.kubeconfig) },
        method: "GET",
        path: API_ROUTES.k8s.get,
        query: {
          kind: input.kind,
          name: input.name,
          namespace: input.namespace,
        },
        signal: input.signal,
      })
    );
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    return null;
  }
}

async function getObjects(input: {
  kind: string;
  kubeconfig: string;
  names: readonly string[];
  namespace: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  const objects = await Promise.all(
    input.names.map((name) => getObject({ ...input, name }))
  );
  return objects.flatMap((object) => (object == null ? [] : [object]));
}

async function presetDefaultOpenPort(input: {
  kubeconfig: string;
  namespace: string;
  port: number;
  service: Record<string, unknown>;
  serviceName: string;
  signal?: AbortSignal;
}): Promise<void> {
  const annotations = objectValue(
    objectValue(input.service.metadata)?.annotations
  );
  const preset = annotations?.[BRAIN_DEFAULT_OPEN_PORT_ANNOTATION];
  if (typeof preset === "string" && preset.trim() !== "") {
    return;
  }
  await fetcher({
    base: ApiUrl(),
    body: {
      metadata: {
        annotations: {
          [BRAIN_DEFAULT_OPEN_PORT_ANNOTATION]: String(input.port),
        },
      },
    },
    header: { Authorization: kubeconfigBearerHeader(input.kubeconfig) },
    method: "PATCH",
    path: API_ROUTES.k8s.patch,
    query: {
      kind: "services",
      name: input.serviceName,
      namespace: input.namespace,
      type: "merge",
    },
    signal: input.signal,
  });
}

/** Provider input declarations, as `key -> default` for absent args. */
function providerInputDefaults(source: unknown): Record<string, string> {
  const inputs = objectValue(source)?.inputs;
  const out: Record<string, string> = {};
  for (const item of Array.isArray(inputs) ? inputs : []) {
    const input = objectValue(item);
    const key = typeof input?.key === "string" ? input.key.trim() : "";
    if (key !== "" && typeof input?.default === "string") {
      out[key] = input.default;
    }
  }
  return out;
}

/**
 * Template Entries (ADR 0081) for an instance the template provider applied.
 * Brain did not render these documents, so it reads them back: the declared
 * entries off the template source, the resolved defaults off the Instance
 * CR, the inputs from this run's memory, and the Ingresses, Services, and
 * App CR from the cluster. The same pure rules as Brain's own renderer then
 * decide the URLs and preset the Default Open Port on the matched Service.
 * Entries are advisory: any failure here degrades to no declared entry and
 * the automatic rule, never to a failed deployment.
 */
/** Whether a declared entry substitutes a user input (`${{ inputs.* }}`). */
function entrySubstitutesInputs(value: string): boolean {
  return TEMPLATE_INPUT_EXPRESSION.test(value);
}

const TEMPLATE_INPUT_EXPRESSION = /\$\{\{[^}]*\binputs\./;

/**
 * The declared entries this run can render truthfully: with no args in hand
 * (an already-created instance), an entry that substitutes an input is
 * dropped rather than rendered from the template's default, which the user
 * may have overridden at create time.
 */
function renderableDeclaredEntries(
  declared: TemplateDeclaredEntries,
  args: Record<string, string> | undefined
): TemplateDeclaredEntries {
  if (args !== undefined) {
    return declared;
  }
  return {
    ...(declared.open === undefined || entrySubstitutesInputs(declared.open)
      ? {}
      : { open: declared.open }),
    ...(declared.share === undefined || entrySubstitutesInputs(declared.share)
      ? {}
      : { share: declared.share }),
  };
}

export async function templateProviderTemplateEntries(input: {
  /**
   * This run's create-time args, memory only. Absent for an instance created
   * before this run; input-bound entries are then dropped, not defaulted.
   */
  args?: Record<string, string>;
  instanceName: string;
  kubeconfig: string;
  namespace: string;
  resources: readonly TemplateDeploymentResourceSummary[];
  routingDomain?: string;
  signal?: AbortSignal;
  templateName: string;
}): Promise<TemplateEntryUrls | undefined> {
  try {
    return await resolveProviderEntries(input);
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    console.warn(
      `[deploy-task] Could not resolve template entries for instance ${input.instanceName}.`,
      error
    );
    return undefined;
  }
}

async function resolveProviderEntries(
  input: Parameters<typeof templateProviderTemplateEntries>[0]
): Promise<TemplateEntryUrls | undefined> {
  const read = {
    kubeconfig: input.kubeconfig,
    namespace: input.namespace,
    signal: input.signal,
  };
  const source = await getTemplateSource({
    encodedKubeconfig: input.kubeconfig,
    templateName: input.templateName,
  });
  const declared = renderableDeclaredEntries(
    templateDeclaredEntries(source.templateYaml),
    input.args
  );
  const appNames = new Set([
    ...resourceNames(input.resources, APP_RESOURCE_TYPES),
    input.instanceName,
  ]);
  const [ingresses, services, apps, instance] = await Promise.all([
    getObjects({
      ...read,
      kind: "ingresses",
      names: resourceNames(input.resources, INGRESS_RESOURCE_TYPES),
    }),
    getObjects({
      ...read,
      kind: "services",
      names: resourceNames(input.resources, SERVICE_RESOURCE_TYPES),
    }),
    getObjects({ ...read, kind: "apps", names: [...appNames] }),
    declared.open === undefined && declared.share === undefined
      ? Promise.resolve(null)
      : getObject({ ...read, kind: "instances", name: input.instanceName }),
  ]);
  const rendered =
    declared.open === undefined && declared.share === undefined
      ? {}
      : renderTemplateEntryExpressions({
          declared,
          defaults: {
            ...templateInstanceDefaults(instance),
            app_name: input.instanceName,
          },
          inputs: {
            ...providerInputDefaults(source.source),
            ...(input.args ?? {}),
          },
          namespace: input.namespace,
          routingDomain: input.routingDomain,
        });
  const docs = [...ingresses, ...services, ...apps];
  const entries = resolveTemplateEntryUrls({
    appUrl: templateAppUrlFromDocs(apps),
    declared: rendered,
    hosts: templateIngressHostsFromDocs(ingresses),
  });
  if (entries.open !== undefined) {
    const target = templateEntryOpenPort({ docs, openUrl: entries.open });
    const service = services.find(
      (candidate) =>
        objectValue(candidate.metadata)?.name === target?.serviceName
    );
    if (target !== undefined && service !== undefined) {
      await presetDefaultOpenPort({
        ...read,
        port: target.port,
        service,
        serviceName: target.serviceName,
      });
    }
  }
  return entries.open === undefined && entries.share === undefined
    ? undefined
    : entries;
}
