import YAML from "yaml";

import { childResourceName } from "@/features/deploy/project-child-resource-name";
import { joinKubeYamlDocuments } from "@/features/deploy/render-yaml-template";
import {
  evaluateTemplateCondition,
  type RenderedTemplateDeployment,
  renderTemplateDeploymentFromYaml,
  type TemplateEvaluationContext,
  templateSourceFromInlineYaml,
} from "@/features/deploy/template-renderer";

import type {
  DeploymentTaskDeploymentPlan,
  DeploymentTaskDeploymentPlanInput,
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
} from "./schema";
import {
  isSensitiveDeploymentInput,
  MIN_SENSITIVE_INPUT_LENGTH,
  type SensitiveDeploymentInputShape,
  withoutSensitiveArgs,
} from "./sensitive-inputs";

const SUPPORTED_API_VERSION = "brain.io/direct";
const SUPPORTED_KINDS = new Set(["AP", "DB"]);
const BRAIN_PROJECT_ID_LABEL = "brain.io/project-id";
const SEALOS_TEMPLATE_BUILD_REQUIRED_KINDS = new Set([
  "CronJob",
  "DaemonSet",
  "Deployment",
  "StatefulSet",
]);
const SEALOS_TEMPLATE_BLOCKED_KINDS = new Set([
  "APIService",
  "ClusterRole",
  "ClusterRoleBinding",
  "CustomResourceDefinition",
  "MutatingWebhookConfiguration",
  "Namespace",
  "Node",
  "PersistentVolume",
  "StorageClass",
  "ValidatingWebhookConfiguration",
]);

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
  projectId: string | null;
  projectName: string | null;
}

export interface DeploymentBrainManifestArtifact {
  kind: "brain-manifest";
  yaml: string;
}

export interface DeploymentTemplateInstanceArtifact {
  instanceName: string;
  kind: "template-instance";
  resources: {
    name: string;
    resourceType: string;
    uid: string;
  }[];
  templateName: string;
}

export interface DeploymentSealosTemplateArtifact {
  build: DeploymentSealosTemplateBuildSummary;
  instanceName: string;
  kind: "sealos-template";
  rendered: RenderedTemplateDeployment;
  templateName: string;
}

export interface DeploymentSealosTemplateBuildSummary {
  digest: string | null;
  image: string | null;
  job: string | null;
  mode: string | null;
  namespace: string | null;
  pod: string | null;
  status: string | null;
  statusRaw?: string | null;
}

/**
 * In-memory-only intent to create a template instance. It carries the full,
 * memory-merged args — sensitive material under ADR 0037 — and therefore MUST
 * NOT be persisted. It exists so the provider POST that actually creates the
 * instance runs inside the create-resources apply step
 * (`applyDeploymentArtifact`), not during prepare-template: that makes a
 * provider/K8s creation failure attributable to the step that owns creation.
 * `applyDeploymentArtifact` turns it into a `template-instance` artifact — the
 * only form that ever reaches the persisted row summary.
 */
export interface DeploymentTemplateInstancePendingArtifact {
  args: Record<string, string>;
  extraLabels: Record<string, string>;
  instanceName: string;
  kind: "template-instance-pending";
  templateName: string;
}

export type DeploymentArtifact =
  | DeploymentBrainManifestArtifact
  | DeploymentSealosTemplateArtifact
  | DeploymentTemplateInstanceArtifact
  | DeploymentTemplateInstancePendingArtifact;

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

function stringRecordValue(value: unknown): Record<string, string> {
  const record = objectValue(value) ?? {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : []
    )
  );
}

function templateNameFromYaml(templateYaml: string): string | null {
  const templateDoc = YAML.parseAllDocuments(templateYaml)[0]?.toJS() as
    | { metadata?: { name?: string } }
    | null
    | undefined;
  return templateDoc?.metadata?.name?.trim() || null;
}

function templateYamlSensitiveShape(
  key: string,
  value: unknown
): SensitiveDeploymentInputShape {
  const record = objectValue(value);
  return {
    key,
    sensitive: record?.sensitive === true,
    type: typeof record?.type === "string" ? record.type : undefined,
  };
}

function sensitiveScalarValue(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }
  const normalized = String(value);
  return normalized.length > 0 ? normalized : null;
}

function stripSensitiveTemplateYamlInputs(input: {
  document: ReturnType<typeof YAML.parseAllDocuments>[number];
  inputs: unknown;
}): {
  sensitiveInputs: SensitiveDeploymentInputShape[];
  sensitiveValues: string[];
} {
  const entries = Array.isArray(input.inputs)
    ? input.inputs.flatMap((value, index) => {
        const key = stringValue(objectValue(value)?.key);
        return key == null ? [] : [{ key, pathKey: index, value }];
      })
    : Object.entries(objectValue(input.inputs) ?? {}).map(([key, value]) => ({
        key,
        pathKey: key,
        value,
      }));
  const sensitiveInputs: SensitiveDeploymentInputShape[] = [];
  const sensitiveValues: string[] = [];
  for (const entry of entries) {
    const shape = templateYamlSensitiveShape(entry.key, entry.value);
    if (!isSensitiveDeploymentInput(shape)) {
      continue;
    }
    sensitiveInputs.push({ ...shape, sensitive: true });
    const record = objectValue(entry.value);
    const defaultValue = sensitiveScalarValue(record?.default);
    if (defaultValue != null) {
      sensitiveValues.push(defaultValue);
    }
    for (const option of Array.isArray(record?.options) ? record.options : []) {
      const optionValue = sensitiveScalarValue(option);
      if (optionValue != null) {
        sensitiveValues.push(optionValue);
      }
    }
    input.document.deleteIn(["spec", "inputs", entry.pathKey, "default"]);
    input.document.deleteIn(["spec", "inputs", entry.pathKey, "options"]);
  }
  return { sensitiveInputs, sensitiveValues };
}

function stripSensitiveTemplateYamlDefaults(input: {
  defaults: unknown;
  document: ReturnType<typeof YAML.parseAllDocuments>[number];
}): string[] {
  const sensitiveValues: string[] = [];
  for (const [key, value] of Object.entries(
    objectValue(input.defaults) ?? {}
  )) {
    if (!isSensitiveDeploymentInput(templateYamlSensitiveShape(key, value))) {
      continue;
    }
    const record = objectValue(value);
    const sensitiveValue = sensitiveScalarValue(
      record != null && "value" in record ? record.value : value
    );
    if (sensitiveValue != null) {
      sensitiveValues.push(sensitiveValue);
    }
    input.document.deleteIn(["spec", "defaults", key]);
  }
  return sensitiveValues;
}

export function persistableSealosTemplate(templateYaml: string): {
  sensitiveInputs: SensitiveDeploymentInputShape[];
  sensitiveValues: string[];
  templateYaml: string;
} {
  const documents = YAML.parseAllDocuments(templateYaml);
  const templateDocument = documents[0];
  const template = objectValue(templateDocument?.toJS());
  if (
    templateDocument == null ||
    template?.apiVersion !== "app.sealos.io/v1" ||
    template.kind !== "Template"
  ) {
    return { sensitiveInputs: [], sensitiveValues: [], templateYaml };
  }

  const spec = objectValue(template.spec);
  const inputSecrets = stripSensitiveTemplateYamlInputs({
    document: templateDocument,
    inputs: spec?.inputs,
  });
  const sensitiveValues = [
    ...inputSecrets.sensitiveValues,
    ...stripSensitiveTemplateYamlDefaults({
      defaults: spec?.defaults,
      document: templateDocument,
    }),
  ];

  return {
    sensitiveInputs: inputSecrets.sensitiveInputs,
    sensitiveValues: [...new Set(sensitiveValues)],
    templateYaml: documents
      .map((document) => document.toString())
      .join("")
      .trimEnd(),
  };
}

export function persistableSealosTemplateYaml(templateYaml: string): string {
  return persistableSealosTemplate(templateYaml).templateYaml;
}

function templateInstanceName(input: {
  deliveryManifest: Record<string, unknown>;
  projectName: string;
  templateName: string;
}): string {
  const manifestApp = objectValue(input.deliveryManifest.app);
  return childResourceName(
    stringValue(manifestApp?.name) ?? input.templateName ?? input.projectName,
    "template"
  );
}

export function deployTaskStringRecordValue(
  value: unknown
): Record<string, string> {
  return stringRecordValue(value);
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
  projectId: string | null;
}) {
  const metadata = objectValue(input.doc.metadata) ?? {};
  const labels = objectValue(metadata.labels) ?? {};
  input.doc.metadata = {
    ...metadata,
    labels: {
      ...labels,
      [BRAIN_PROJECT_ID_LABEL]: input.projectId ?? input.projectName,
    },
  };
}

function normalizeDirectProductDoc(input: {
  doc: Record<string, unknown>;
  namespace: string;
  projectName: string;
  projectId: string | null;
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
      projectId: input.projectId ?? input.projectName,
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
        projectId: input.task.projectId,
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

export function prepareBrainManifestArtifact(input: {
  artifact: DeploymentBrainManifestArtifact;
  task: DeployTaskArtifactContext;
}): DeployTaskPreparedArtifacts {
  const output = {
    resourceYamls: [input.artifact.yaml],
  };
  return prepareDeployTaskArtifacts({
    output,
    task: input.task,
  });
}

const BUILD_RESULT_FAILURE_STATUSES = new Set([
  "canceled",
  "cancelled",
  "error",
  "failed",
  "failure",
]);

const BUILD_RESULT_RUNNING_STATUSES = new Set([
  "building",
  "in_progress",
  "pending",
  "queued",
  "running",
]);

const BUILD_RESULT_SUCCESS_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "ok",
  "passed",
  "success",
  "successful",
  "succeeded",
]);

export function normalizeBuildResultStatus(
  status: string | null
): string | null {
  if (status == null) {
    return null;
  }
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (BUILD_RESULT_SUCCESS_STATUSES.has(normalized)) {
    return "succeeded";
  }
  if (normalized === "skipped") {
    return "skipped";
  }
  if (BUILD_RESULT_FAILURE_STATUSES.has(normalized)) {
    return "failed";
  }
  if (BUILD_RESULT_RUNNING_STATUSES.has(normalized)) {
    return "running";
  }
  return normalized;
}

function assertBuildResultNotExplicitlyFailed(
  buildResult: Record<string, unknown>
) {
  const status = stringValue(buildResult.status);
  const normalizedStatus = normalizeBuildResultStatus(status);
  if (normalizedStatus !== "failed" && normalizedStatus !== "running") {
    return normalizedStatus;
  }
  const error = objectValue(buildResult.error);
  throw new Error(
    stringValue(error?.message) ??
      `Sealos build result did not succeed (${status ?? "missing status"}).`
  );
}

function buildResultImage(buildResult: Record<string, unknown>): string | null {
  const image = objectValue(buildResult.image);
  return (
    stringValue(image?.image_ref) ??
    stringValue(image?.reference) ??
    stringValue(image?.ref)
  );
}

function buildResultDigest(
  buildResult: Record<string, unknown>
): string | null {
  const image = objectValue(buildResult.image);
  return stringValue(image?.digest);
}

function buildResultKubernetes(buildResult: Record<string, unknown>) {
  const kubernetes = objectValue(buildResult.kubernetes);
  if (kubernetes == null) {
    return null;
  }
  return {
    job: stringValue(kubernetes.job),
    namespace: stringValue(kubernetes.namespace),
    pod: stringValue(kubernetes.pod),
  };
}

function buildSummary(
  buildResult: Record<string, unknown>
): DeploymentSealosTemplateBuildSummary {
  const kubernetes = buildResultKubernetes(buildResult);
  const status = stringValue(buildResult.status);
  const normalizedStatus = normalizeBuildResultStatus(status);
  return {
    digest: buildResultDigest(buildResult),
    image: buildResultImage(buildResult),
    job: kubernetes?.job ?? null,
    mode: stringValue(buildResult.mode),
    namespace: kubernetes?.namespace ?? null,
    pod: kubernetes?.pod ?? null,
    status: normalizedStatus,
    ...(status === normalizedStatus ? {} : { statusRaw: status }),
  };
}

function deploymentResourceSummary(resource: {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
}): DeployTaskApplyResourceSummary | null {
  const name = resource.metadata?.name?.trim();
  const namespace = resource.metadata?.namespace?.trim();
  if (!(name && namespace)) {
    return null;
  }
  return {
    apiVersion: resource.apiVersion?.trim() ?? "",
    kind: resource.kind?.trim() ?? "",
    name,
    namespace,
  };
}

function collectRenderedImages(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectRenderedImages);
  }
  const record = objectValue(value);
  if (record == null) {
    return [];
  }
  return [
    ...(typeof record.image === "string" && record.image.trim()
      ? [record.image.trim()]
      : []),
    ...Object.entries(record).flatMap(([key, item]) =>
      key === "image" ? [] : collectRenderedImages(item)
    ),
  ];
}

function renderedImageMatchesBuild(input: {
  buildDigest: string;
  buildImage: string;
  renderedImage: string;
}): boolean {
  return (
    input.renderedImage === input.buildImage ||
    input.renderedImage.includes(`@${input.buildDigest}`)
  );
}

function assertSupportedSealosTemplateResources(
  rendered: RenderedTemplateDeployment
) {
  for (const resource of rendered.resources) {
    const kind = resource.kind?.trim();
    if (!kind) {
      throw new Error(
        "Sealos template output includes Kubernetes resource with missing kind."
      );
    }
    if (SEALOS_TEMPLATE_BLOCKED_KINDS.has(kind)) {
      throw new Error(
        `Sealos template output includes blocked Kubernetes kind ${kind}.`
      );
    }
  }
}

function assertSealosTemplateBuildBinding(input: {
  build: DeploymentSealosTemplateBuildSummary;
  rendered: RenderedTemplateDeployment;
}) {
  if (input.build.status === "skipped") {
    return;
  }
  const images = input.rendered.resources
    .filter((resource) =>
      SEALOS_TEMPLATE_BUILD_REQUIRED_KINDS.has(resource.kind?.trim() ?? "")
    )
    .flatMap(collectRenderedImages);
  if (images.length === 0) {
    return;
  }
  const buildImage = input.build.image;
  if (buildImage == null) {
    throw new Error("Sealos build result is missing image.image_ref.");
  }
  if (input.build.digest == null) {
    throw new Error("Sealos build result is missing image.digest.");
  }
  const buildDigest = input.build.digest;
  if (
    !images.some((renderedImage) =>
      renderedImageMatchesBuild({
        buildDigest,
        buildImage,
        renderedImage,
      })
    )
  ) {
    throw new Error(
      "Sealos template workload image does not match the succeeded build image."
    );
  }
}

function templateInputDefaults(
  inputs: DeploymentTaskDeploymentPlanInput[],
  args: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    inputs.map((input) => [input.key, args[input.key] ?? input.default ?? ""])
  );
}

function visibleTemplatePlanInputs(input: {
  args: Record<string, string>;
  defaults?: DeploymentTaskDeploymentPlan["defaults"];
  inputs: DeploymentTaskDeploymentPlanInput[];
}): DeploymentTaskDeploymentPlanInput[] {
  const context: TemplateEvaluationContext = {
    defaults: Object.fromEntries(
      Object.entries(input.defaults ?? {}).map(([key, value]) => [
        key,
        value.value,
      ])
    ),
    inputs: templateInputDefaults(input.inputs, input.args),
  };
  return input.inputs.filter((item) => {
    const condition = item.if?.trim();
    if (!condition) {
      return true;
    }
    return evaluateTemplateCondition(condition, context);
  });
}

function templateInputLabel(input: { key: string; label?: string }) {
  return input.label?.trim() || input.key;
}

function templateInputBlockingType(
  input: DeploymentTaskDeploymentPlanInput
): DeployTaskBlockingInput["type"] {
  if (input.sensitive) {
    return "secret";
  }
  const type = input.type?.trim().toLowerCase();
  if (type === "env" || input.key === input.key.toUpperCase()) {
    return "env";
  }
  return "text";
}

export function createSealosTemplateDeploymentPlan(input: {
  deliveryManifest: Record<string, unknown>;
  /** AI-authored secret values must be re-collected from a user submission. */
  requireFreshSensitiveValues?: boolean;
  templateYaml: string;
}): DeploymentTaskDeploymentPlan {
  const parsed = templateSourceFromInlineYaml(input.templateYaml);
  const args = stringRecordValue(input.deliveryManifest.args);
  const inputs = (parsed.source.source.inputs ?? []).map((item) => ({
    ...item,
    sensitive: isSensitiveDeploymentInput(item),
  }));
  const visibleInputs = visibleTemplatePlanInputs({
    args,
    defaults: parsed.source.source.defaults,
    inputs,
  });
  const missingInputKeys = visibleInputs.flatMap((item) => {
    if (item.sensitive) {
      const provided = args[item.key];
      // Gateway-authored args/defaults are not user proof for a secret. The AI
      // path explicitly requires a fresh submission; the template runner may
      // trust a value already supplied by its credentialed request.
      return input.requireFreshSensitiveValues === true ||
        provided === undefined ||
        provided === "" ||
        provided.length < MIN_SENSITIVE_INPUT_LENGTH
        ? [item.key]
        : [];
    }
    const provided = args[item.key];
    if (provided !== undefined && provided !== "") {
      return [];
    }
    if (item.default !== undefined && item.default !== "") {
      return [];
    }
    if (item.required) {
      return [item.key];
    }
    return [];
  });
  const persistableInputs = visibleInputs.map((item) => {
    if (!item.sensitive) {
      return item;
    }
    const { default: _default, options: _options, ...persistable } = item;
    return persistable;
  });
  return {
    args: withoutSensitiveArgs(args, inputs),
    inputs: persistableInputs,
    kind: "sealos-template",
    ...(missingInputKeys.length === 0 ? {} : { missingInputKeys }),
    templateName: parsed.templateName,
  };
}

/**
 * Inputs the blocking form must (re)collect to resume: missing values, plus
 * every sensitive input — sensitive values are never persisted (ADR 0037),
 * so a resume can only get them from a fresh submission (US15).
 */
export function blockingInputsFromDeploymentPlan(
  plan: DeploymentTaskDeploymentPlan
): DeployTaskBlockingInput[] {
  const missing = new Set(plan.missingInputKeys ?? []);
  return plan.inputs
    .filter((input) => missing.has(input.key) || input.sensitive === true)
    .map((input) => ({
      ...(input.default === undefined || input.sensitive === true
        ? {}
        : { defaultValue: input.default }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      id: input.key,
      key: input.key,
      label: templateInputLabel(input),
      ...(input.options === undefined || input.sensitive === true
        ? {}
        : { options: input.options }),
      required: missing.has(input.key) || input.required === true,
      sensitive: input.sensitive,
      type: templateInputBlockingType(input),
      valueType: input.type,
    }));
}

export function prepareSealosTemplateArtifact(input: {
  args?: Record<string, string>;
  buildResult: Record<string, unknown>;
  certSecretName?: string;
  deliveryManifest: Record<string, unknown>;
  /** Recorded result identity to converge on (redeploy, ADR 0038). */
  instanceName?: string;
  routingDomain?: string;
  task: DeployTaskArtifactContext;
  templateYaml: string;
}): DeploymentSealosTemplateArtifact {
  const projectName = input.task.projectName?.trim();
  if (!projectName) {
    throw new Error(
      "Sealos template output cannot be applied without a Project name."
    );
  }
  assertBuildResultNotExplicitlyFailed(input.buildResult);
  const build = buildSummary(input.buildResult);
  const templateName = templateNameFromYaml(input.templateYaml) ?? projectName;
  const instanceName =
    input.instanceName?.trim() ||
    templateInstanceName({
      deliveryManifest: input.deliveryManifest,
      projectName,
      templateName,
    });

  const rendered = renderTemplateDeploymentFromYaml({
    args: {
      ...stringRecordValue(input.deliveryManifest.args),
      ...(input.args ?? {}),
    },
    certSecretName: input.certSecretName,
    instanceName,
    namespace: input.task.namespace,
    projectId: input.task.projectId ?? projectName,
    projectName,
    routingDomain: input.routingDomain,
    templateYaml: input.templateYaml,
  });
  assertSupportedSealosTemplateResources(rendered);
  assertSealosTemplateBuildBinding({ build, rendered });
  return {
    build,
    instanceName: rendered.instanceName,
    kind: "sealos-template",
    rendered,
    templateName,
  };
}

export function sealosTemplateArtifactSummary(input: {
  appliedResources?: { name: string; resourceType: string; uid: string }[];
  artifact: DeploymentSealosTemplateArtifact;
  notes?: string;
}): DeployTaskArtifactSummary {
  const renderedYaml = joinKubeYamlDocuments([
    input.artifact.rendered.instanceYaml,
    ...input.artifact.rendered.dependentYamls,
  ]);
  const resources = input.artifact.rendered.resources
    .map(deploymentResourceSummary)
    .filter(
      (resource): resource is DeployTaskApplyResourceSummary => resource != null
    );
  return {
    artifacts: [
      {
        build: input.artifact.build,
        instanceName: input.artifact.instanceName,
        kind: input.artifact.kind,
        templateName: input.artifact.templateName,
      },
    ],
    ...(input.appliedResources === undefined
      ? {}
      : { appliedResources: input.appliedResources }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    buildResult: input.artifact.build,
    resources,
    resourceYamls: [renderedYaml],
  };
}
