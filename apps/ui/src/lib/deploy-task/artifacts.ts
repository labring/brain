import YAML from "yaml";

import { joinKubeYamlDocuments } from "@/lib/render-yaml-template";

const SUPPORTED_API_VERSION = "brain.io/direct";
const SUPPORTED_KINDS = new Set(["AP", "DB"]);
const BRAIN_PROJECT_ID_LABEL = "brain.io/project-id";

export interface DeployTaskApplyResourceSummary {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
}

export interface DeployTaskPreparedArtifacts {
  resources: DeployTaskApplyResourceSummary[];
  yaml: string;
}

export interface DeployTaskArtifactContext {
  namespace: string;
  projectName: string | null;
  projectUid: string | null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function outputYamlDocuments(output: Record<string, unknown>): string[] {
  return [
    ...stringArrayValue(output.resourceYamls),
    ...stringArrayValue(output.resources),
    ...stringArrayValue(output.manifests),
    ...(typeof output.entrypointYaml === "string"
      ? [output.entrypointYaml]
      : []),
  ];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ensureDeploymentOutputSucceeded(output: Record<string, unknown>) {
  const deploymentOutput = objectValue(output.deploymentOutput);
  if (deploymentOutput == null) {
    return;
  }

  const status = stringValue(deploymentOutput.status);
  if (status !== "succeeded") {
    const error = stringValue(deploymentOutput.error);
    throw new Error(error ?? "Deployment skill did not succeed.");
  }
}

function ensureBrainProjectIdentity(input: {
  doc: Record<string, unknown>;
  projectName: string;
  projectUid: string | null;
}) {
  const metadata = objectValue(input.doc.metadata) ?? {};
  const labels = objectValue(metadata.labels) ?? {};
  input.doc.metadata = {
    ...metadata,
    labels: {
      ...labels,
      [BRAIN_PROJECT_ID_LABEL]: input.projectUid ?? input.projectName,
    },
  };
}

function normalizeDirectProductDoc(input: {
  doc: Record<string, unknown>;
  namespace: string;
  projectName: string;
  projectUid: string | null;
}): DeployTaskApplyResourceSummary {
  const apiVersion = stringValue(input.doc.apiVersion);
  const kind = stringValue(input.doc.kind);
  if (
    apiVersion !== SUPPORTED_API_VERSION ||
    !SUPPORTED_KINDS.has(kind ?? "")
  ) {
    throw new Error(
      `Unsupported deploy artifact ${apiVersion ?? "<missing>"}/${kind ?? "<missing>"}.`
    );
  }

  const metadata = objectValue(input.doc.metadata) ?? {};
  const name = stringValue(metadata.name);
  if (name == null) {
    throw new Error(`Deploy artifact ${kind} is missing metadata.name.`);
  }

  input.doc.metadata = {
    ...metadata,
    name,
    namespace: input.namespace,
  };
  ensureBrainProjectIdentity(input);

  if (kind === "AP" || kind === "DB") {
    const spec = objectValue(input.doc.spec) ?? {};
    if (
      kind === "AP" &&
      ("image" in spec || "ports" in spec || objectValue(spec.input) == null)
    ) {
      throw new Error(
        "Deploy AP artifact must use spec.input.image and spec.input.network; top-level spec.image/spec.ports are not supported."
      );
    }
    input.doc.spec = {
      ...Object.fromEntries(
        Object.entries(spec).filter(([key]) => key !== "projectName")
      ),
      projectId: input.projectUid ?? input.projectName,
    };
  }

  return {
    apiVersion,
    kind: kind ?? "",
    name,
    namespace: input.namespace,
  };
}

export function prepareDeployTaskArtifacts(input: {
  output: Record<string, unknown>;
  task: DeployTaskArtifactContext;
}): DeployTaskPreparedArtifacts {
  const projectName = input.task.projectName?.trim();
  if (!projectName) {
    throw new Error("Deploy output cannot be applied without a Project name.");
  }
  ensureDeploymentOutputSucceeded(input.output);

  const docs = outputYamlDocuments(input.output)
    .map((raw) => raw.trim())
    .filter(Boolean);
  if (docs.length === 0) {
    throw new Error("Deploy output did not include resource YAMLs to apply.");
  }

  const resources: DeployTaskApplyResourceSummary[] = [];
  const normalizedDocs = docs.map((raw) => {
    const parsed = YAML.parse(raw);
    const doc = objectValue(parsed);
    if (doc == null) {
      throw new Error("Deploy artifact YAML must be an object document.");
    }
    resources.push(
      normalizeDirectProductDoc({
        doc,
        namespace: input.task.namespace,
        projectName,
        projectUid: input.task.projectUid,
      })
    );
    return YAML.stringify(doc).trimEnd();
  });

  const duplicate = resources.find(
    (resource, index) =>
      resources.findIndex(
        (candidate) =>
          candidate.kind === resource.kind &&
          candidate.namespace === resource.namespace &&
          candidate.name === resource.name
      ) !== index
  );
  if (duplicate != null) {
    throw new Error(
      `Deploy output contains duplicate ${duplicate.kind}/${duplicate.name}.`
    );
  }

  return {
    resources,
    yaml: joinKubeYamlDocuments(normalizedDocs),
  };
}
