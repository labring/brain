import YAML from "yaml";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_MANAGED_BY_VALUE,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
  LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL,
  LAUNCHPAD_TEMPLATE_SOURCE_LABEL,
} from "@/lib/brain-labels";
import type {
  TemplateDefaultValue,
  TemplateSourceInput,
  TemplateSourcePayload,
} from "./template-provider-core";

const TEMPLATE_INSTANCE_API_VERSION = "app.sealos.io/v1";
const TEMPLATE_INSTANCE_KIND = "Instance";
const OWNER_REFERENCES_LABEL = "cloud.sealos.io/owner-references";
const OWNER_REFERENCES_READY_VALUE = "ready";
const YAML_IF_ENDIF_RE =
  /^\s*\$\{\{\s*?(if|elif|else|endif)\((.*?)\)\s*?\}\}\s*$/gm;
const TEMPLATE_EXPR_RE = /\$\{\{\s*(.*?)\s*\}\}/g;
const DNS_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const BRACKET_PATH_RE = /\[['"]([^'"]+)['"]\]/g;
const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;
const RANDOM_CALL_RE = /^random\((\d+)\)$/;
const BASE64_CALL_RE = /^base64\((.*)\)$/;
const TERNARY_RE = /^(.+?)\?(.+?):(.+)$/;
const OR_SPLIT_RE = /\s+\|\|\s+/;
const AND_SPLIT_RE = /\s+&&\s+/;
const CONCAT_SPLIT_RE = /\s+\+\s+/;
const COMPARISON_RE = /^(.*?)\s*(===|!==|==|!=)\s*(.*?)$/;
const BOOLEAN_VALUE_RE = /^(true|false)$/i;
const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const CLUSTER_SCOPED_KINDS = new Set([
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

export interface RenderTemplateDeploymentInput {
  args?: Record<string, string>;
  instanceName: string;
  namespace: string;
  projectId: string;
  projectName: string;
  routingDomain?: string;
  source: TemplateSourcePayload;
  templateName: string;
}

export interface RenderedTemplateDeployment {
  dependentYamls: string[];
  instanceName: string;
  instanceYaml: string;
  resources: TemplateK8sObject[];
}

export interface TemplateK8sObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    labels?: Record<string, string>;
    name?: string;
    namespace?: string;
    ownerReferences?: unknown[];
    uid?: string;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TemplateInstanceOwnerReference {
  apiVersion: "app.sealos.io/v1";
  blockOwnerDeletion: false;
  controller: false;
  kind: "Instance";
  name: string;
  uid: string;
}

interface EvaluationContext {
  defaults: Record<string, string>;
  inputs: Record<string, string>;
  [key: string]: unknown;
}

interface TemplateApWorkloadInfo {
  name: string;
  podLabels: Record<string, string>;
}

interface TemplateResourceClassification {
  appName?: string;
  resourceKind: "ap" | "db" | "template";
}

function randomLowercase(length: number): string {
  const n = Number.isFinite(length) && length > 0 ? Math.floor(length) : 8;
  const bytes = new Uint8Array(n);
  if (globalThis.crypto == null) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  } else {
    globalThis.crypto.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => RANDOM_ALPHABET[byte % 26]).join("");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function cloneObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitPath(path: string): string[] {
  return path
    .trim()
    .replace(BRACKET_PATH_RE, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readPath(context: EvaluationContext, path: string): unknown {
  let cursor: unknown = context;
  for (const part of splitPath(path)) {
    if (cursor == null || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function unquote(value: string): string | null {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== "'" && quote !== '"') || trimmed.at(-1) !== quote) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function expressionValue(
  expression: string,
  context: EvaluationContext
): unknown {
  const trimmed = expression.trim();
  const quoted = unquote(trimmed);
  if (quoted != null) {
    return quoted;
  }
  if (NUMERIC_RE.test(trimmed)) {
    return Number(trimmed);
  }
  const randomMatch = trimmed.match(RANDOM_CALL_RE);
  if (randomMatch) {
    return randomLowercase(Number(randomMatch[1]));
  }
  const base64Match = trimmed.match(BASE64_CALL_RE);
  if (base64Match) {
    return Buffer.from(
      String(expressionValue(base64Match[1] ?? "", context) ?? "")
    ).toString("base64");
  }
  return readPath(context, trimmed);
}

function evaluateExpression(
  expression: string,
  context: EvaluationContext
): unknown {
  const ternary = expression.match(TERNARY_RE);
  if (ternary) {
    return evaluateCondition(ternary[1] ?? "", context)
      ? evaluateExpression(ternary[2] ?? "", context)
      : evaluateExpression(ternary[3] ?? "", context);
  }
  const orParts = expression.split(OR_SPLIT_RE);
  if (orParts.length > 1) {
    for (const part of orParts) {
      const value = evaluateExpression(part, context);
      if (value) {
        return value;
      }
    }
    return "";
  }
  const concatParts = expression.split(CONCAT_SPLIT_RE);
  if (concatParts.length > 1) {
    return concatParts
      .map((part) => String(evaluateExpression(part, context) ?? ""))
      .join("");
  }
  return expressionValue(expression, context);
}

function evaluateCondition(
  expression: string,
  context: EvaluationContext
): boolean {
  const trimmed = expression.trim();
  const orParts = trimmed.split(OR_SPLIT_RE);
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateCondition(part, context));
  }
  const andParts = trimmed.split(AND_SPLIT_RE);
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateCondition(part, context));
  }
  const comparison = trimmed.match(COMPARISON_RE);
  if (comparison) {
    const left = evaluateExpression(comparison[1] ?? "", context);
    const right = evaluateExpression(comparison[3] ?? "", context);
    return comparison[2]?.includes("!") ? left !== right : left === right;
  }
  return Boolean(evaluateExpression(trimmed, context));
}

// Sealos template condition blocks support nested if/elif/else/endif markers.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors the provider parser to preserve template semantics.
function parseYamlIfEndif(source: string, context: EvaluationContext): string {
  const stack: RegExpMatchArray[] = [];
  let ifCount = 0;
  const matches = Array.from(source.matchAll(YAML_IF_ENDIF_RE));
  if (matches.length === 0) {
    return source;
  }

  for (const match of matches) {
    const type = match[1];
    if (type === "if") {
      ifCount += 1;
    } else if (type === "endif") {
      ifCount -= 1;
      if (ifCount < 0) {
        throw new Error("endif without matching if");
      }
    }
    if (type === "if" || type === "elif" || type === "else") {
      stack.push(match);
      continue;
    }

    let ifMatch: RegExpMatchArray | undefined;
    const elifElseMatches: RegExpMatchArray[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (
        current &&
        (current[1] === "if" ||
          (elifElseMatches.length > 0 && current[1] === "else"))
      ) {
        ifMatch = current;
        break;
      }
      if (current) {
        elifElseMatches.unshift(current);
      }
    }
    if (ifMatch == null) {
      throw new Error("endif without matching if");
    }
    if (stack.length !== 0) {
      continue;
    }

    const start = source.slice(0, ifMatch.index);
    const end = source.slice((match.index ?? 0) + match[0].length);
    let between = "";
    for (const clause of [ifMatch, ...elifElseMatches]) {
      const clauseIndex = clause.index ?? 0;
      const nextClause = elifElseMatches[elifElseMatches.indexOf(clause) + 1];
      const blockEnd =
        clause === elifElseMatches.at(-1) || nextClause == null
          ? (match.index ?? 0)
          : (nextClause.index ?? 0);
      if (clause[1] === "else" || evaluateCondition(clause[2] ?? "", context)) {
        between = source.slice(clauseIndex + clause[0].length, blockEnd);
        break;
      }
    }
    return parseYamlIfEndif(start + between + end, context);
  }
  if (ifCount !== 0) {
    throw new Error("Unmatched if statement found");
  }
  return source;
}

function renderTemplateString(
  source: string,
  context: EvaluationContext
): string {
  return parseYamlIfEndif(source, context).replace(
    TEMPLATE_EXPR_RE,
    (_match, expression: string) =>
      String(evaluateExpression(expression, context) ?? "")
  );
}

function flattenDefaults(
  defaults: Record<string, TemplateDefaultValue> | undefined,
  context: EvaluationContext
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(defaults ?? {})) {
    out[key] = renderTemplateString(String(item.value ?? ""), {
      ...context,
      defaults: out,
    });
  }
  return out;
}

function resolvedInputs(
  inputs: TemplateSourceInput[] | undefined,
  args: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of inputs ?? []) {
    const provided = args?.[input.key];
    let value: string | undefined;
    if (provided !== undefined && provided !== "") {
      value = provided;
    } else if (input.default !== undefined && input.default !== "") {
      value = input.default;
    } else if (!input.required) {
      value = input.default ?? "";
    }
    if (value === undefined) {
      throw new Error(`Missing required parameters: ${input.key}.`);
    }
    validateTemplateInputValue(input, value);
    out[input.key] = value;
  }
  return out;
}

function validateTemplateInputValue(
  input: TemplateSourceInput,
  value: string
): void {
  if (hasUnsafeTemplateScalarCharacter(value) || value.includes("${{")) {
    throw new Error(`Template parameter "${input.key}" must be a single line.`);
  }
  const options = Array.isArray(input.options) ? input.options : [];
  if (options.length > 0 && !options.includes(value)) {
    throw new Error(
      `Template parameter "${input.key}" is not an allowed value.`
    );
  }
  const type = input.type?.trim().toLowerCase();
  if (type === "number" && !NUMERIC_RE.test(value.trim())) {
    throw new Error(`Template parameter "${input.key}" must be a number.`);
  }
  if (type === "boolean" && !BOOLEAN_VALUE_RE.test(value.trim())) {
    throw new Error(`Template parameter "${input.key}" must be true or false.`);
  }
}

function hasUnsafeTemplateScalarCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 0 || code === 10 || code === 13) {
      return true;
    }
  }
  return false;
}

/*
 * Keep user-provided template inputs as plain scalar values. They are substituted
 * into provider YAML before parsing, so multi-line values would be able to alter
 * the rendered document structure.
 */

function templateInstanceObject(
  source: TemplateSourcePayload,
  instanceName: string
): TemplateK8sObject {
  const template = asRecord(source.templateYaml) ?? {};
  const spec = asRecord(template.spec) ?? {};
  return {
    apiVersion: TEMPLATE_INSTANCE_API_VERSION,
    kind: TEMPLATE_INSTANCE_KIND,
    metadata: { name: instanceName },
    spec: {
      author: requiredString(spec.author),
      categories: Array.isArray(spec.categories) ? spec.categories : [],
      defaults: asRecord(spec.defaults) ?? {},
      description: requiredString(spec.description),
      draft: spec.draft === true,
      gitRepo: spec.gitRepo,
      icon: requiredString(spec.icon),
      inputs: asRecord(spec.inputs) ?? {},
      readme: requiredString(spec.readme),
      templateType: spec.templateType ?? spec.template_type,
      title: requiredString(spec.title),
      url: requiredString(spec.url),
    },
  };
}

function ensureMetadata(object: TemplateK8sObject) {
  object.metadata ??= {};
  return object.metadata;
}

function ensureLabels(meta: TemplateK8sObject["metadata"]) {
  if (meta == null) {
    return {};
  }
  meta.labels ??= {};
  return meta.labels;
}

function normalizeEnvValues(object: TemplateK8sObject) {
  const containers = asRecord(
    asRecord(asRecord(object.spec)?.template)?.spec
  )?.containers;
  if (!Array.isArray(containers)) {
    return;
  }
  for (const container of containers) {
    const containerRecord = asRecord(container);
    if (containerRecord == null) {
      continue;
    }
    const env = containerRecord.env;
    if (!Array.isArray(env)) {
      continue;
    }
    const normalizedEnv: unknown[] = [];
    const indexesByName = new Map<string, number>();
    for (const row of env) {
      appendNormalizedEnvRow(row, normalizedEnv, indexesByName);
    }
    containerRecord.env = normalizedEnv;
  }
}

function normalizeEnvValue(record: Record<string, unknown>) {
  if (record.value == null) {
    return;
  }
  if (typeof record.value === "object") {
    record.value = JSON.stringify(record.value);
    return;
  }
  if (typeof record.value === "number" || typeof record.value === "boolean") {
    record.value = String(record.value);
  }
}

function appendNormalizedEnvRow(
  row: unknown,
  normalizedEnv: unknown[],
  indexesByName: Map<string, number>
) {
  const record = asRecord(row);
  if (record == null) {
    normalizedEnv.push(row);
    return;
  }
  normalizeEnvValue(record);

  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name === "") {
    normalizedEnv.push(row);
    return;
  }
  const existingIndex = indexesByName.get(name);
  if (existingIndex === undefined) {
    indexesByName.set(name, normalizedEnv.length);
    normalizedEnv.push(row);
    return;
  }
  normalizedEnv[existingIndex] = row;
}

function normalizeServicePorts(object: TemplateK8sObject) {
  if (object.kind !== "Service") {
    return;
  }
  const ports = asRecord(object.spec)?.ports;
  if (!Array.isArray(ports)) {
    return;
  }
  for (const port of ports) {
    const record = asRecord(port);
    if (record == null || !("containerPort" in record)) {
      continue;
    }
    if (record.targetPort == null) {
      record.targetPort = record.containerPort;
    }
    record.containerPort = undefined;
  }
}

function normalizeRenderedResource(object: TemplateK8sObject) {
  normalizeEnvValues(object);
  normalizeServicePorts(object);
}

function isTemplateManagedApWorkload(object: TemplateK8sObject): boolean {
  return object.kind === "Deployment" || object.kind === "StatefulSet";
}

function isTemplateManagedDbCluster(object: TemplateK8sObject): boolean {
  return object.kind === "Cluster";
}

function objectMetadataName(object: TemplateK8sObject): string {
  return object.metadata?.name?.trim() ?? "";
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record == null) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" && item !== "") {
      out[key] = item;
    }
  }
  return out;
}

function templateApWorkloads(
  objects: TemplateK8sObject[]
): TemplateApWorkloadInfo[] {
  return objects.flatMap((object) => {
    if (!isTemplateManagedApWorkload(object)) {
      return [];
    }
    const name = objectMetadataName(object);
    if (name === "") {
      return [];
    }
    return [
      {
        name,
        podLabels: stringRecord(
          asRecord(asRecord(asRecord(object.spec)?.template)?.metadata)?.labels
        ),
      },
    ];
  });
}

function selectorMatchesPodLabels(
  selector: Record<string, string>,
  podLabels: Record<string, string>
): boolean {
  const entries = Object.entries(selector);
  return (
    entries.length > 0 &&
    entries.every(([key, value]) => podLabels[key] === value)
  );
}

function serviceApNameForResource(
  service: TemplateK8sObject,
  workloads: TemplateApWorkloadInfo[]
): string | undefined {
  const serviceName = objectMetadataName(service);
  const selector = stringRecord(asRecord(service.spec)?.selector);
  for (const workload of workloads) {
    if (
      workload.name === serviceName ||
      selectorMatchesPodLabels(selector, workload.podLabels)
    ) {
      return workload.name;
    }
  }
  return undefined;
}

function ingressBackendServiceNames(ingress: TemplateK8sObject): Set<string> {
  const names = new Set<string>();
  const defaultBackendName = asRecord(
    asRecord(ingress.spec)?.defaultBackend
  )?.service;
  const defaultServiceName = asRecord(defaultBackendName)?.name;
  if (typeof defaultServiceName === "string" && defaultServiceName !== "") {
    names.add(defaultServiceName);
  }
  const rules = asRecord(ingress.spec)?.rules;
  if (!Array.isArray(rules)) {
    return names;
  }
  for (const rule of rules) {
    const paths = asRecord(asRecord(rule)?.http)?.paths;
    if (!Array.isArray(paths)) {
      continue;
    }
    for (const path of paths) {
      const serviceName = asRecord(
        asRecord(asRecord(path)?.backend)?.service
      )?.name;
      if (typeof serviceName === "string" && serviceName !== "") {
        names.add(serviceName);
      }
    }
  }
  return names;
}

function setTemplateApClassification(
  classifications: Map<TemplateK8sObject, TemplateResourceClassification>,
  object: TemplateK8sObject
): boolean {
  if (!isTemplateManagedApWorkload(object)) {
    return false;
  }
  classifications.set(object, {
    appName: objectMetadataName(object),
    resourceKind: "ap",
  });
  return true;
}

function setTemplateDbClassification(
  classifications: Map<TemplateK8sObject, TemplateResourceClassification>,
  object: TemplateK8sObject
): boolean {
  if (!isTemplateManagedDbCluster(object)) {
    return false;
  }
  classifications.set(object, { resourceKind: "db" });
  return true;
}

function setTemplateServiceClassification(input: {
  apNameByServiceName: Map<string, string>;
  classifications: Map<TemplateK8sObject, TemplateResourceClassification>;
  object: TemplateK8sObject;
  workloads: TemplateApWorkloadInfo[];
}): boolean {
  if (input.object.kind !== "Service") {
    return false;
  }
  const appName = serviceApNameForResource(input.object, input.workloads);
  if (appName === undefined) {
    return false;
  }
  input.classifications.set(input.object, { appName, resourceKind: "ap" });
  const serviceName = objectMetadataName(input.object);
  if (serviceName !== "") {
    input.apNameByServiceName.set(serviceName, appName);
  }
  return true;
}

function setTemplateIngressClassification(input: {
  apNameByServiceName: Map<string, string>;
  classifications: Map<TemplateK8sObject, TemplateResourceClassification>;
  object: TemplateK8sObject;
}) {
  if (
    input.classifications.has(input.object) ||
    input.object.kind !== "Ingress"
  ) {
    return;
  }
  for (const serviceName of ingressBackendServiceNames(input.object)) {
    const appName = input.apNameByServiceName.get(serviceName);
    if (appName !== undefined) {
      input.classifications.set(input.object, { appName, resourceKind: "ap" });
      return;
    }
  }
}

function templateResourceClassifications(
  objects: TemplateK8sObject[]
): Map<TemplateK8sObject, TemplateResourceClassification> {
  const classifications = new Map<
    TemplateK8sObject,
    TemplateResourceClassification
  >();
  const workloads = templateApWorkloads(objects);
  const apNameByServiceName = new Map<string, string>();

  for (const object of objects) {
    if (setTemplateApClassification(classifications, object)) {
      continue;
    }
    if (setTemplateDbClassification(classifications, object)) {
      continue;
    }
    setTemplateServiceClassification({
      apNameByServiceName,
      classifications,
      object,
      workloads,
    });
  }

  for (const object of objects) {
    setTemplateIngressClassification({
      apNameByServiceName,
      classifications,
      object,
    });
  }

  return classifications;
}

function applyTemplateProviderLabels(
  labels: Record<string, string>,
  input: RenderTemplateDeploymentInput,
  classification: TemplateResourceClassification
) {
  if (classification.resourceKind !== "ap") {
    return;
  }
  labels[LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL] =
    labels[LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL] ?? input.instanceName;
}

function applyBrainDeploymentLabels(
  labels: Record<string, string>,
  input: RenderTemplateDeploymentInput
) {
  labels[BRAIN_PROJECT_ID_LABEL] = input.projectId;
  labels[BRAIN_MANAGED_BY_LABEL] = BRAIN_MANAGED_BY_VALUE;
  labels[BRAIN_DEPLOYMENT_KIND_LABEL] = "template";
  labels[BRAIN_DEPLOYMENT_NAME_LABEL] = input.instanceName;
  labels[BRAIN_TEMPLATE_NAME_LABEL] = input.templateName;
}

function applyPodTemplateLabels(
  object: TemplateK8sObject,
  input: RenderTemplateDeploymentInput,
  classification: TemplateResourceClassification
) {
  const templateLabels = asRecord(
    asRecord(asRecord(object.spec)?.template)?.metadata
  )?.labels;
  if (templateLabels == null) {
    return;
  }
  const labels = templateLabels as Record<string, string>;
  applyBrainDeploymentLabels(labels, input);
  applyTemplateProviderLabels(labels, input, classification);
}

function applyVolumeClaimTemplateLabels(
  object: TemplateK8sObject,
  input: RenderTemplateDeploymentInput,
  classification: TemplateResourceClassification
) {
  const volumeClaimTemplates = asRecord(object.spec)?.volumeClaimTemplates;
  if (!Array.isArray(volumeClaimTemplates)) {
    return;
  }
  for (const claim of volumeClaimTemplates) {
    const claimMeta = asRecord(claim)?.metadata;
    if (claimMeta == null) {
      continue;
    }
    const metadata = claimMeta as Record<string, unknown>;
    if (metadata.labels == null) {
      metadata.labels = {};
    }
    const claimLabels = metadata.labels as Record<string, string>;
    claimLabels[LAUNCHPAD_TEMPLATE_SOURCE_LABEL] = input.instanceName;
    applyBrainDeploymentLabels(claimLabels, input);
    applyTemplateProviderLabels(claimLabels, input, classification);
  }
}

function applyResourceLabels(
  object: TemplateK8sObject,
  input: RenderTemplateDeploymentInput,
  classification: TemplateResourceClassification
) {
  const meta = ensureMetadata(object);
  if (!CLUSTER_SCOPED_KINDS.has(object.kind ?? "")) {
    meta.namespace = input.namespace;
  }
  const labels = ensureLabels(meta);
  labels[LAUNCHPAD_TEMPLATE_SOURCE_LABEL] = input.instanceName;
  applyBrainDeploymentLabels(labels, input);
  applyTemplateProviderLabels(labels, input, classification);
  if (object.kind === "App") {
    labels[LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL] =
      labels[LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL] ?? input.instanceName;
  }

  applyPodTemplateLabels(object, input, classification);
  applyVolumeClaimTemplateLabels(object, input, classification);
  normalizeRenderedResource(object);
}

function parseRenderedObjects(yaml: string): TemplateK8sObject[] {
  return YAML.parseAllDocuments(yaml)
    .map((doc) => doc.toJS())
    .filter((doc) => doc != null)
    .map((doc) => doc as TemplateK8sObject);
}

function dumpObject(object: TemplateK8sObject): string {
  return YAML.stringify(object).trimEnd();
}

export function generateTemplateInstanceOwnerReference(
  instanceName: string,
  uid: string
): TemplateInstanceOwnerReference {
  return {
    apiVersion: TEMPLATE_INSTANCE_API_VERSION,
    blockOwnerDeletion: false,
    controller: false,
    kind: TEMPLATE_INSTANCE_KIND,
    name: instanceName,
    uid,
  };
}

export function addTemplateInstanceOwnerReferences(
  objects: TemplateK8sObject[],
  ownerReference: TemplateInstanceOwnerReference
): TemplateK8sObject[] {
  return objects.map((object) => {
    const copy = cloneObject(object);
    if (
      copy.kind === TEMPLATE_INSTANCE_KIND ||
      CLUSTER_SCOPED_KINDS.has(copy.kind ?? "")
    ) {
      return copy;
    }
    const meta = ensureMetadata(copy);
    const existing = Array.isArray(meta.ownerReferences)
      ? meta.ownerReferences
      : [];
    const next = existing.filter(
      (ref) =>
        !(
          asRecord(ref)?.apiVersion === ownerReference.apiVersion &&
          asRecord(ref)?.kind === ownerReference.kind &&
          asRecord(ref)?.name === ownerReference.name
        )
    );
    meta.ownerReferences = [...next, ownerReference];
    return copy;
  });
}

export function renderTemplateDeployment(
  input: RenderTemplateDeploymentInput
): RenderedTemplateDeployment {
  if (!DNS_NAME_RE.test(input.instanceName) || input.instanceName.length > 63) {
    throw new Error("Template instance name must be a valid DNS name.");
  }
  const baseContext: EvaluationContext = {
    defaults: {},
    inputs: {},
    SEALOS_NAMESPACE: input.namespace,
  };
  const defaults = {
    ...flattenDefaults(input.source.source.defaults, baseContext),
    app_name: input.instanceName,
  };
  const inputs = resolvedInputs(input.source.source.inputs, input.args);
  const routingDomain = input.routingDomain?.trim();
  const context: EvaluationContext = {
    ...input.source.source,
    defaults,
    inputs,
    ...(routingDomain ? { SEALOS_CLOUD_DOMAIN: routingDomain } : {}),
    SEALOS_NAMESPACE: input.namespace,
  };
  const instance = templateInstanceObject(input.source, input.instanceName);
  const sourceResources = parseRenderedObjects(input.source.appYaml);
  const sourceHasInstance = sourceResources.some(
    (resource) =>
      resource.kind === TEMPLATE_INSTANCE_KIND &&
      resource.apiVersion === TEMPLATE_INSTANCE_API_VERSION
  );
  const fullYaml = sourceHasInstance
    ? input.source.appYaml
    : `${dumpObject(instance)}\n---\n${input.source.appYaml}`;
  const rendered = renderTemplateString(fullYaml, context);
  const resources = parseRenderedObjects(rendered);
  if (resources.length === 0) {
    throw new Error("Template rendered no Kubernetes resources.");
  }
  const classifications = templateResourceClassifications(resources);
  for (const resource of resources) {
    applyResourceLabels(
      resource,
      input,
      classifications.get(resource) ?? {
        resourceKind: "template",
      }
    );
  }
  const instanceResource = resources.find(
    (resource) =>
      resource.kind === TEMPLATE_INSTANCE_KIND &&
      resource.apiVersion === TEMPLATE_INSTANCE_API_VERSION
  );
  if (instanceResource == null) {
    throw new Error("Template rendered no Instance resource.");
  }
  ensureMetadata(instanceResource).name = input.instanceName;
  ensureLabels(ensureMetadata(instanceResource))[OWNER_REFERENCES_LABEL] =
    OWNER_REFERENCES_READY_VALUE;
  const dependents = resources.filter(
    (resource) => resource !== instanceResource
  );
  return {
    dependentYamls: dependents.map(dumpObject),
    instanceName: input.instanceName,
    instanceYaml: dumpObject(instanceResource),
    resources,
  };
}
