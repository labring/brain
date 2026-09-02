import YAML from "yaml";
import type { DatabaseInstancePreset } from "@/features/deploy/database-deployer";
import { BRAIN_DISPLAY_NAME_ANNOTATION } from "@/lib/brain-labels";
import { renderYamlTemplate } from "./render-yaml-template";

const DIRECT_PRODUCT_API_VERSION = "brain.io/direct";

interface RenderDbDeploymentYamlOptions {
  /** Resource Display Name written into the annotation at deploy time (ADR 0066). */
  displayName?: string;
  engine: string;
  name: string;
  namespace: string;
  projectName: string;
  quota: DatabaseInstancePreset;
  replicas: number;
  template?: string;
}

function baseDbManifest(options: RenderDbDeploymentYamlOptions) {
  return {
    apiVersion: DIRECT_PRODUCT_API_VERSION,
    kind: "DB",
    metadata: {
      name: options.name,
      namespace: options.namespace,
    },
    spec: {},
  };
}

function parseTemplate(template: string | undefined) {
  const trimmed = template?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = YAML.parse(trimmed);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

function removePrivateOnlyRegionLabel(doc: Record<string, unknown>) {
  const metadata =
    doc.metadata && typeof doc.metadata === "object"
      ? { ...(doc.metadata as Record<string, unknown>) }
      : {};
  const labels =
    metadata.labels && typeof metadata.labels === "object"
      ? { ...(metadata.labels as Record<string, unknown>) }
      : {};
  const labelsWithoutRegion = Object.fromEntries(
    Object.entries(labels).filter(([key]) => key !== "region")
  );
  const metadataWithoutLabels = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "labels")
  );

  const nextMetadata: Record<string, unknown> =
    Object.keys(labelsWithoutRegion).length === 0
      ? metadataWithoutLabels
      : { ...metadata, labels: labelsWithoutRegion };
  doc.metadata = nextMetadata;
}

export function renderDbDeploymentYaml(
  options: RenderDbDeploymentYamlOptions
): string {
  const template =
    options.template == null
      ? undefined
      : renderYamlTemplate(options.template, {
          name: options.name,
          namespace: options.namespace,
        });
  const doc = parseTemplate(template) ?? baseDbManifest(options);
  doc.apiVersion = DIRECT_PRODUCT_API_VERSION;
  doc.kind = "DB";

  const metadata =
    doc.metadata && typeof doc.metadata === "object"
      ? { ...(doc.metadata as Record<string, unknown>) }
      : {};
  const displayName = options.displayName?.trim();
  const annotations =
    metadata.annotations && typeof metadata.annotations === "object"
      ? { ...(metadata.annotations as Record<string, unknown>) }
      : {};
  if (displayName) {
    annotations[BRAIN_DISPLAY_NAME_ANNOTATION] = displayName;
  }
  doc.metadata = {
    ...metadata,
    ...(Object.keys(annotations).length === 0 ? {} : { annotations }),
    name: options.name,
    namespace: options.namespace,
  };
  removePrivateOnlyRegionLabel(doc);

  const spec =
    doc.spec && typeof doc.spec === "object"
      ? { ...(doc.spec as Record<string, unknown>) }
      : {};

  doc.spec = {
    ...Object.fromEntries(
      Object.entries(spec).filter(
        ([key]) => key !== "legacyRuntime" && key !== "projectName"
      )
    ),
    engine: options.engine,
    // Always false today. The first field that exposes one owes the nodeport
    // quota validation ADR-0070 places on requesting fields.
    exposeNodePort: false,
    projectId: options.projectName,
    quota: options.quota,
    replicas: Math.min(10, Math.max(1, Math.round(options.replicas))),
  };

  return YAML.stringify(doc).trimEnd();
}
