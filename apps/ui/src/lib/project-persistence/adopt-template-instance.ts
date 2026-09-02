import "server-only";

import { API_ROUTES } from "@workspace/api/constants";
import { and, eq } from "drizzle-orm";

import { derivedProjectDisplayNameBase } from "@/features/projects/derived-project-display-name";
import {
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
  LAUNCHPAD_TEMPLATE_SOURCE_LABEL,
  templateDeploymentExtraLabels,
} from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";

import { getProjectDb } from "./db";
import {
  type BrainProject,
  createProject,
  createProjectWithDerivedDisplayName,
  deleteProject,
  getProject,
} from "./projects";
import {
  type TemplateInstanceAdoptionRow,
  templateInstanceAdoptions,
} from "./schema";

export type TemplateInstanceAdoptionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type TemplateInstanceAdoptionStatus = "adopting" | "adopted" | "failed";

export const TEMPLATE_INSTANCE_ADOPTION_MAX_RESOURCES = 500;
const LABEL_CONCURRENCY = 8;
const SEALOS_INSTANCE_API_VERSION = "app.sealos.io/v1";
const SEALOS_INSTANCE_KIND = "Instance";
const TRAILING_PERIOD_RE = /\.$/;
const UNKNOWN_RESOURCE_RE = /unknown resource/i;
const NOT_FOUND_RE = /not found/i;

const ADOPTION_RESOURCE_KINDS = [
  "instances",
  "deployments",
  "statefulsets",
  "services",
  "ingresses",
  "certificates",
  "issuers",
  "horizontalpodautoscalers",
  "clusters",
  "opsrequests",
  "configmaps",
  "secrets",
  "persistentvolumeclaims",
  "jobs",
  "pods",
] as const;

const POD_TEMPLATE_RESOURCE_KINDS = new Set([
  "cronjobs",
  "daemonsets",
  "deployments",
  "jobs",
  "statefulsets",
]);

export const ADOPTION_WARNING = {
  clusterScopedSkipped: "clusterScopedSkipped",
  incompleteResourceSet: "incompleteResourceSet",
  podTemplateLabelsUnchanged: "podTemplateLabelsUnchanged",
} as const;

export class TemplateInstanceAdoptionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TemplateInstanceAdoptionError";
    this.status = status;
  }
}

export interface AdoptTemplateInstanceInput {
  apiBaseUrl?: string;
  description?: string;
  displayName?: string;
  encodedKubeconfig: string;
  fetchImpl?: TemplateInstanceAdoptionFetch;
  instanceName: string;
  namespace: string;
  templateName?: string;
}

export interface TemplateInstanceAdoptionResult {
  adoption: {
    discoveredCount: number;
    instanceName: string;
    instanceUid: string;
    labeledCount: number;
    status: "adopted" | "failed";
    warnings: string[];
  };
  project: BrainProject;
}

interface DiscoveredObject {
  apiVersion: string;
  kind: string;
  labels: Record<string, string>;
  name: string;
  namespace: string;
  ownerReferences: OwnerReference[];
  resourceKind: string;
  uid: string;
}

interface OwnerReference {
  apiVersion: string;
  kind: string;
  uid: string;
}

interface AdoptionK8sContext {
  apiBaseUrl: string;
  encodedKubeconfig: string;
  fetchImpl: TemplateInstanceAdoptionFetch;
  namespace: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string
): string {
  if (record == null) {
    return "";
  }
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringLabelMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record == null) {
    return {};
  }
  const labels: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      labels[key] = entry;
    }
  }
  return labels;
}

function ownerReferencesFrom(value: unknown): OwnerReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: OwnerReference[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const apiVersion = stringField(record, "apiVersion");
    const kind = stringField(record, "kind");
    const uid = stringField(record, "uid");
    if (apiVersion === "" || kind === "" || uid === "") {
      continue;
    }
    refs.push({ apiVersion, kind, uid });
  }
  return refs;
}

function parseUnstructured(
  payload: unknown,
  resourceKind: string
): DiscoveredObject | null {
  const record = asRecord(payload);
  if (record == null) {
    return null;
  }
  const metadata = asRecord(record.metadata);
  const name = stringField(metadata, "name");
  if (name === "") {
    return null;
  }
  return {
    apiVersion: stringField(record, "apiVersion"),
    kind: stringField(record, "kind"),
    labels: stringLabelMap(metadata?.labels),
    name,
    namespace: stringField(metadata, "namespace"),
    ownerReferences: ownerReferencesFrom(metadata?.ownerReferences),
    resourceKind,
    uid: stringField(metadata, "uid"),
  };
}

function listItems(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (record == null) {
    return [];
  }
  return Array.isArray(record.items) ? record.items : [];
}

function responseErrorText(body: unknown): string {
  const record = asRecord(body);
  if (record == null) {
    return "";
  }
  for (const key of ["error", "detail", "message"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  if (Array.isArray(record.errors)) {
    for (const entry of record.errors) {
      const nested = asRecord(entry);
      const message = stringField(nested, "message");
      if (message !== "") {
        return message;
      }
    }
  }
  return "";
}

function isUnknownResourceFailure(status: number, body: unknown): boolean {
  if (status === 404) {
    return true;
  }
  return UNKNOWN_RESOURCE_RE.test(responseErrorText(body));
}

function isNotFoundFailure(status: number, body: unknown): boolean {
  if (status === 404) {
    return true;
  }
  const text = responseErrorText(body);
  return NOT_FOUND_RE.test(text) && !UNKNOWN_RESOURCE_RE.test(text);
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => null);
}

function apiUrl(baseUrl: string, path: string, params: URLSearchParams): URL {
  const base = baseUrl.trim();
  if (base === "") {
    throw new TemplateInstanceAdoptionError(
      502,
      "API_URL is required to adopt template instance resources."
    );
  }
  const url = new URL(path, base);
  url.search = params.toString();
  return url;
}

function k8sHeaders(encodedKubeconfig: string): HeadersInit {
  return {
    Authorization: kubeconfigBearerHeader(encodedKubeconfig),
    "Content-Type": "application/json",
  };
}

async function k8sGet(
  context: AdoptionK8sContext,
  params: Record<string, string>
): Promise<{ body: unknown; status: number }> {
  const response = await context.fetchImpl(
    apiUrl(context.apiBaseUrl, API_ROUTES.k8s.get, new URLSearchParams(params)),
    {
      cache: "no-store",
      headers: k8sHeaders(context.encodedKubeconfig),
    }
  );
  return { body: await readJson(response), status: response.status };
}

async function k8sPatchLabels(
  context: AdoptionK8sContext,
  input: {
    kind: string;
    labels: Record<string, string>;
    name: string;
    namespace: string;
  }
): Promise<{ body: unknown; status: number }> {
  const params = new URLSearchParams({
    kind: input.kind,
    name: input.name,
    namespace: input.namespace,
    type: "merge",
  });
  const response = await context.fetchImpl(
    apiUrl(context.apiBaseUrl, API_ROUTES.k8s.patch, params),
    {
      body: JSON.stringify({ metadata: { labels: input.labels } }),
      cache: "no-store",
      headers: k8sHeaders(context.encodedKubeconfig),
      method: "PATCH",
    }
  );
  return { body: await readJson(response), status: response.status };
}

function k8sFailureMessage(
  operation: string,
  status: number,
  body: unknown
): string {
  const detail = responseErrorText(body);
  const fallback = `Failed to ${operation} template instance resources (${status}).`;
  if (detail === "") {
    return fallback;
  }
  return `${fallback.replace(TRAILING_PERIOD_RE, "")}: ${detail}`;
}

function belongsToInstance(
  object: DiscoveredObject,
  input: { instanceName: string; instanceUid: string }
): boolean {
  const instanceRefs = object.ownerReferences.filter(
    (ref) =>
      ref.apiVersion === SEALOS_INSTANCE_API_VERSION &&
      ref.kind === SEALOS_INSTANCE_KIND
  );
  if (instanceRefs.some((ref) => ref.uid === input.instanceUid)) {
    return true;
  }
  if (instanceRefs.some((ref) => ref.uid !== input.instanceUid)) {
    return false;
  }
  return object.labels[LAUNCHPAD_TEMPLATE_SOURCE_LABEL] === input.instanceName;
}

function objectKey(object: DiscoveredObject): string {
  if (object.uid !== "") {
    return object.uid;
  }
  return `${object.resourceKind}/${object.namespace}/${object.name}`;
}

function brainAdoptionLabels(input: {
  instanceName: string;
  projectId: string;
  templateName: string;
}): Record<string, string> {
  const labels = {
    ...templateDeploymentExtraLabels({
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    }),
  };
  if (input.templateName === "") {
    delete labels[BRAIN_TEMPLATE_NAME_LABEL];
  }
  return labels;
}

function derivedDisplayNameBase(input: {
  instanceName: string;
  templateName: string;
}): string {
  return (
    derivedProjectDisplayNameBase({
      kind: "template",
      templateName: input.templateName,
    }) ??
    derivedProjectDisplayNameBase({
      kind: "template",
      templateName: input.instanceName,
    }) ??
    input.instanceName
  );
}

function whereAdoption(namespace: string, instanceUid: string) {
  return and(
    eq(templateInstanceAdoptions.namespace, namespace),
    eq(templateInstanceAdoptions.instanceUid, instanceUid)
  );
}

async function loadMapping(
  namespace: string,
  instanceUid: string
): Promise<TemplateInstanceAdoptionRow | null> {
  const [row] = await getProjectDb()
    .select()
    .from(templateInstanceAdoptions)
    .where(whereAdoption(namespace, instanceUid))
    .limit(1);
  return row ?? null;
}

async function getInstance(
  context: AdoptionK8sContext,
  instanceName: string
): Promise<DiscoveredObject> {
  const { body, status } = await k8sGet(context, {
    kind: "instances",
    name: instanceName,
    namespace: context.namespace,
  });
  if (
    isNotFoundFailure(status, body) ||
    isUnknownResourceFailure(status, body)
  ) {
    throw new TemplateInstanceAdoptionError(
      404,
      "Template instance not found."
    );
  }
  if (status < 200 || status >= 300) {
    throw new TemplateInstanceAdoptionError(
      502,
      k8sFailureMessage("inspect", status, body)
    );
  }
  const instance = parseUnstructured(body, "instances");
  if (
    instance == null ||
    instance.apiVersion !== SEALOS_INSTANCE_API_VERSION ||
    instance.kind !== SEALOS_INSTANCE_KIND
  ) {
    throw new TemplateInstanceAdoptionError(
      400,
      "Resource is not a Sealos Template Instance."
    );
  }
  if (instance.uid === "") {
    throw new TemplateInstanceAdoptionError(
      400,
      "Template instance is missing a uid."
    );
  }
  return instance;
}

async function listKind(
  context: AdoptionK8sContext,
  kind: string,
  instanceName: string
): Promise<DiscoveredObject[]> {
  const { body, status } = await k8sGet(context, {
    kind,
    "label-selector": `${LAUNCHPAD_TEMPLATE_SOURCE_LABEL}=${instanceName}`,
    namespace: context.namespace,
  });
  if (isUnknownResourceFailure(status, body)) {
    return [];
  }
  if (status < 200 || status >= 300) {
    throw new TemplateInstanceAdoptionError(
      502,
      k8sFailureMessage("inspect", status, body)
    );
  }
  const objects: DiscoveredObject[] = [];
  for (const item of listItems(body)) {
    const parsed = parseUnstructured(item, kind);
    if (parsed != null) {
      objects.push(parsed);
    }
  }
  return objects;
}

async function discoverResources(
  context: AdoptionK8sContext,
  instance: DiscoveredObject
): Promise<{
  clusterScopedSkipped: boolean;
  objects: DiscoveredObject[];
}> {
  const byKey = new Map<string, DiscoveredObject>();
  byKey.set(objectKey(instance), instance);

  let clusterScopedSkipped = false;
  for (const kind of ADOPTION_RESOURCE_KINDS) {
    const listed = await listKind(context, kind, instance.name);
    for (const object of listed) {
      if (
        !belongsToInstance(object, {
          instanceName: instance.name,
          instanceUid: instance.uid,
        })
      ) {
        continue;
      }
      if (object.namespace === "") {
        clusterScopedSkipped = true;
        continue;
      }
      if (object.namespace !== context.namespace) {
        continue;
      }
      byKey.set(objectKey(object), object);
    }
  }

  return {
    clusterScopedSkipped,
    objects: [...byKey.values()],
  };
}

function foreignProjectId(
  objects: DiscoveredObject[],
  projectId: string | undefined
): boolean {
  for (const object of objects) {
    const labeled = object.labels[BRAIN_PROJECT_ID_LABEL]?.trim() ?? "";
    if (labeled === "") {
      continue;
    }
    if (projectId == null || labeled !== projectId) {
      return true;
    }
  }
  return false;
}

async function ensureMapping(input: {
  description?: string;
  displayName?: string;
  instanceName: string;
  instanceUid: string;
  namespace: string;
  templateName: string;
}): Promise<{ mapping: TemplateInstanceAdoptionRow; project: BrainProject }> {
  const existing = await loadMapping(input.namespace, input.instanceUid);
  if (existing != null) {
    const project = await getProject(input.namespace, existing.projectId);
    if (project == null) {
      throw new TemplateInstanceAdoptionError(
        502,
        "Adopted project is missing."
      );
    }
    const now = new Date();
    const [updated] = await getProjectDb()
      .update(templateInstanceAdoptions)
      .set({
        instanceName: input.instanceName,
        status: "adopting",
        templateName: input.templateName,
        updatedAt: now,
      })
      .where(whereAdoption(input.namespace, input.instanceUid))
      .returning();
    return { mapping: updated ?? existing, project };
  }

  const project =
    input.displayName == null
      ? await createProjectWithDerivedDisplayName({
          derivedDisplayName: derivedDisplayNameBase({
            instanceName: input.instanceName,
            templateName: input.templateName,
          }),
          description: input.description,
          namespace: input.namespace,
        })
      : await createProject({
          description: input.description,
          displayName: input.displayName,
          namespace: input.namespace,
        });

  const now = new Date();
  const [inserted] = await getProjectDb()
    .insert(templateInstanceAdoptions)
    .values({
      createdAt: now,
      discoveredCount: 0,
      instanceName: input.instanceName,
      instanceUid: input.instanceUid,
      labeledCount: 0,
      lastError: null,
      namespace: input.namespace,
      projectId: project.id,
      status: "adopting",
      templateName: input.templateName,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted != null) {
    return { mapping: inserted, project };
  }

  await deleteProject({ id: project.id, namespace: input.namespace });
  const winner = await loadMapping(input.namespace, input.instanceUid);
  if (winner == null) {
    throw new TemplateInstanceAdoptionError(
      502,
      "Failed to persist template instance adoption."
    );
  }
  const winnerProject = await getProject(input.namespace, winner.projectId);
  if (winnerProject == null) {
    throw new TemplateInstanceAdoptionError(502, "Adopted project is missing.");
  }
  return { mapping: winner, project: winnerProject };
}

async function updateMapping(
  namespace: string,
  instanceUid: string,
  values: Partial<
    Pick<
      TemplateInstanceAdoptionRow,
      | "discoveredCount"
      | "labeledCount"
      | "lastError"
      | "status"
      | "instanceName"
      | "templateName"
    >
  >
): Promise<void> {
  await getProjectDb()
    .update(templateInstanceAdoptions)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(whereAdoption(namespace, instanceUid));
}

async function labelObjects(
  context: AdoptionK8sContext,
  objects: DiscoveredObject[],
  labels: Record<string, string>
): Promise<{ failures: string[]; labeledCount: number }> {
  let cursor = 0;
  let labeledCount = 0;
  const failures: string[] = [];

  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const object = objects[index];
      if (object === undefined) {
        return;
      }
      const merged = {
        ...object.labels,
        ...labels,
      };
      try {
        const { body, status } = await k8sPatchLabels(context, {
          kind: object.resourceKind,
          labels: merged,
          name: object.name,
          namespace: object.namespace,
        });
        if (status >= 200 && status < 300) {
          object.labels = merged;
          labeledCount += 1;
          continue;
        }
        failures.push(k8sFailureMessage("label", status, body));
      } catch (error) {
        failures.push(
          error instanceof Error
            ? error.message
            : "Failed to label template instance resources."
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(LABEL_CONCURRENCY, objects.length) }, () =>
      run()
    )
  );
  return { failures, labeledCount };
}

function collectWarnings(input: {
  clusterScopedSkipped: boolean;
  objects: DiscoveredObject[];
}): string[] {
  const warnings: string[] = [];
  if (
    input.objects.length === 1 &&
    input.objects[0]?.resourceKind === "instances"
  ) {
    warnings.push(ADOPTION_WARNING.incompleteResourceSet);
  }
  if (input.clusterScopedSkipped) {
    warnings.push(ADOPTION_WARNING.clusterScopedSkipped);
  }
  if (
    input.objects.some((object) =>
      POD_TEMPLATE_RESOURCE_KINDS.has(object.resourceKind)
    )
  ) {
    warnings.push(ADOPTION_WARNING.podTemplateLabelsUnchanged);
  }
  return warnings;
}

export async function adoptTemplateInstance(
  input: AdoptTemplateInstanceInput
): Promise<TemplateInstanceAdoptionResult> {
  const instanceName = input.instanceName.trim();
  const templateName = input.templateName?.trim() ?? "";
  const context: AdoptionK8sContext = {
    apiBaseUrl: input.apiBaseUrl ?? process.env.API_URL ?? "",
    encodedKubeconfig: input.encodedKubeconfig,
    fetchImpl: input.fetchImpl ?? fetch,
    namespace: input.namespace,
  };
  if (context.apiBaseUrl.trim() === "") {
    throw new TemplateInstanceAdoptionError(
      502,
      "API_URL is required to adopt template instance resources."
    );
  }

  const instance = await getInstance(context, instanceName);
  const discovered = await discoverResources(context, instance);
  if (discovered.objects.length > TEMPLATE_INSTANCE_ADOPTION_MAX_RESOURCES) {
    throw new TemplateInstanceAdoptionError(
      400,
      "Template instance has too many resources to adopt."
    );
  }

  const existing = await loadMapping(input.namespace, instance.uid);
  if (foreignProjectId(discovered.objects, existing?.projectId)) {
    throw new TemplateInstanceAdoptionError(
      409,
      "A discovered resource is already labeled for another project."
    );
  }

  const { project } = await ensureMapping({
    description: input.description,
    displayName: input.displayName,
    instanceName: instance.name,
    instanceUid: instance.uid,
    namespace: input.namespace,
    templateName,
  });

  await updateMapping(input.namespace, instance.uid, {
    discoveredCount: discovered.objects.length,
    instanceName: instance.name,
    status: "adopting",
    templateName,
  });

  const { failures, labeledCount } = await labelObjects(
    context,
    discovered.objects,
    brainAdoptionLabels({
      instanceName: instance.name,
      projectId: project.id,
      templateName,
    })
  );

  if (failures.length > 0) {
    await updateMapping(input.namespace, instance.uid, {
      discoveredCount: discovered.objects.length,
      labeledCount,
      lastError: failures[0],
      status: "failed",
    });
    throw new TemplateInstanceAdoptionError(
      502,
      "Failed to label template instance resources."
    );
  }

  await updateMapping(input.namespace, instance.uid, {
    discoveredCount: discovered.objects.length,
    labeledCount,
    lastError: null,
    status: "adopted",
  });

  return {
    adoption: {
      discoveredCount: discovered.objects.length,
      instanceName: instance.name,
      instanceUid: instance.uid,
      labeledCount,
      status: "adopted",
      warnings: collectWarnings(discovered),
    },
    project,
  };
}
