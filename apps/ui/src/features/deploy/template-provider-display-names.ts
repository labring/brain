import { applyResourceDisplayName } from "@/features/resource-display-name/apply-resource-display-name";
import { projectResourceDisplayNames } from "@/features/resource-display-name/project-resource-display-names";
import {
  type TemplateResourceNamingResource,
  templateResourceDisplayNames,
} from "@/features/resource-display-name/resource-display-name";
import {
  isTemplateProviderClusterResource,
  type TemplateProviderDbResourceSummary,
  type TemplateProviderResourceSummary,
} from "./template-provider-db-labels";

const APP_RESOURCE_TYPES = new Set([
  "app",
  "apps",
  "application",
  "applications",
  "deployment",
  "deployments",
  "statefulset",
  "statefulsets",
]);

export function isTemplateProviderAppResource(
  resource: TemplateProviderResourceSummary
): boolean {
  return (
    resource.name.trim() !== "" &&
    APP_RESOURCE_TYPES.has(resource.resourceType.trim().toLowerCase())
  );
}

/**
 * Stamp deploy-time Resource Display Names (ADR 0066) onto the AP and DB
 * resources one template instance spawned. The template provider creates the
 * resources cluster-side, so the names are written post-create through the
 * product PATCH routes — the same writer the rename surface uses. Naming
 * must never fail a deploy: every failure degrades to the resource showing
 * its Kubernetes name, which stays a legal state the user can rename out of.
 */
export async function stampTemplateProviderDisplayNames(input: {
  dbResources: TemplateProviderDbResourceSummary[];
  kubeconfig: string;
  namespace: string;
  projectId: string;
  resources: TemplateProviderResourceSummary[];
  templateName: string;
}): Promise<void> {
  const dbEngines = new Map(
    input.dbResources.map((resource) => [resource.name, resource.engine])
  );
  const namingResources: TemplateResourceNamingResource[] = [];
  for (const resource of input.resources) {
    const name = resource.name.trim();
    if (isTemplateProviderAppResource(resource)) {
      namingResources.push({ kind: "ap", kubernetesName: name });
    } else if (isTemplateProviderClusterResource(resource)) {
      const engine = dbEngines.get(name);
      namingResources.push({
        ...(engine === undefined ? {} : { engine }),
        kind: "db",
        kubernetesName: name,
      });
    }
  }
  if (namingResources.length === 0) {
    return;
  }

  let takenNames: string[];
  try {
    takenNames = await projectResourceDisplayNames({
      excludeKubernetesNames: namingResources.map(
        (resource) => resource.kubernetesName
      ),
      kubeconfig: input.kubeconfig,
      namespace: input.namespace,
      projectId: input.projectId,
    });
  } catch {
    // An unreadable listing blinds the numbering — skip stamping rather
    // than risk a duplicate the rename surface would itself reject. The
    // resources keep showing their Kubernetes names, the legal degraded
    // state the user can rename out of (ADR 0066).
    return;
  }

  const names = templateResourceDisplayNames({
    resources: namingResources,
    takenNames,
    templateName: input.templateName,
  });
  for (const resource of namingResources) {
    const value = names.get(resource.kubernetesName);
    if (value === undefined) {
      continue;
    }
    try {
      await applyResourceDisplayName({
        kind: resource.kind === "db" ? "DB" : "AP",
        kubeconfig: input.kubeconfig,
        name: resource.kubernetesName,
        namespace: input.namespace,
        value,
      });
    } catch (error) {
      console.warn(
        `[deploy-task] Could not stamp display name "${value}" on template resource ${resource.kubernetesName}.`,
        error
      );
    }
  }
}
