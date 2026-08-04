import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { API_ROUTES } from "@workspace/api/constants";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";

import { getProjectDb } from "./db";
import {
  deleteProjectManagedResources,
  inspectProjectManagedResources,
  type ProjectChildResourceSummary,
  type ProjectDeleteFetch,
} from "./delete-guard";
import {
  type BrainProject,
  deleteProject,
  getProject,
  listProjects,
} from "./projects";
import {
  projectDeleteOperations,
  projectDeletePreviews,
  projectManagementAuditEvents,
} from "./schema";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const OPERATION_TTL_MS = 10 * 60 * 1000;

export type ProjectAggregateStatus =
  | "negative"
  | "neutral"
  | "positive"
  | "progress"
  | "unknown"
  | "warning";

export interface ProjectManagementActor {
  actorUid: string;
  chatId: string;
  encodedKubeconfig: string;
  namespace: string;
}

export interface ManagedProject extends BrainProject {
  aggregateStatus: ProjectAggregateStatus;
}

export interface ProjectDeletionPreview {
  expiresAt: string;
  fingerprint: string;
  previewId: string;
  project: BrainProject;
  resourceSummary: ProjectChildResourceSummary;
}

export type DeleteManagedProjectResult =
  | {
      ok: true;
      project: BrainProject;
      resourceSummary: ProjectChildResourceSummary;
    }
  | {
      code: "deletion_in_progress" | "invalid_preview" | "stale_preview";
      ok: false;
    };

const RESOURCE_SUMMARY_KEYS = [
  "ap",
  "db",
  "template",
  "templateCertificates",
  "templateClusters",
  "templateConfigMaps",
  "templateDeployments",
  "templateIngresses",
  "templateIssuers",
  "templateJobs",
  "templateOpsRequests",
  "templatePersistentVolumeClaims",
  "templatePods",
  "templateSecrets",
  "templateServices",
  "templateStatefulSets",
] as const satisfies readonly (keyof ProjectChildResourceSummary)[];

function sortedSummary(
  resources: ProjectChildResourceSummary
): ProjectChildResourceSummary {
  return Object.fromEntries(
    RESOURCE_SUMMARY_KEYS.map((key) => [key, [...resources[key]].sort()])
  ) as unknown as ProjectChildResourceSummary;
}

export function resourceSummaryFingerprint(
  resources: ProjectChildResourceSummary
): string {
  return createHash("sha256")
    .update(JSON.stringify(sortedSummary(resources)))
    .digest("hex");
}

function auditEvent(input: {
  actor: ProjectManagementActor;
  displayName: string;
  failureCode?: string;
  projectId: string;
  resourceSummary: ProjectChildResourceSummary;
  status: "completed" | "failed" | "previewed" | "started" | "stale";
}): Promise<unknown> {
  return getProjectDb()
    .insert(projectManagementAuditEvents)
    .values({
      action: "delete",
      actorUid: input.actor.actorUid,
      chatId: input.actor.chatId,
      displayName: input.displayName,
      ...(input.failureCode === undefined
        ? {}
        : { failureCode: input.failureCode }),
      id: randomUUID(),
      namespace: input.actor.namespace,
      projectId: input.projectId,
      resourceSummary: sortedSummary(input.resourceSummary),
      source: "chat",
      status: input.status,
    });
}

function apiUrl(path: string, params: Record<string, string>): URL | null {
  const base = process.env.API_URL?.trim() ?? "";
  if (base === "") {
    return null;
  }
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function listItems(payload: unknown): unknown[] {
  if (payload == null || typeof payload !== "object") {
    return [];
  }
  const root = payload as { data?: { items?: unknown }; items?: unknown };
  if (Array.isArray(root.items)) {
    return root.items;
  }
  return Array.isArray(root.data?.items) ? root.data.items : [];
}

const TONE_SEVERITY: Record<
  Exclude<ProjectAggregateStatus, "unknown">,
  number
> = {
  negative: 4,
  neutral: 0,
  positive: 1,
  progress: 2,
  warning: 3,
};

function phaseStatus(
  phase: unknown,
  paused: boolean
): Exclude<ProjectAggregateStatus, "unknown"> {
  if (paused) {
    return "neutral";
  }
  switch (typeof phase === "string" ? phase.trim().toLowerCase() : "") {
    case "running":
    case "succeeded":
    case "ready":
    case "available":
    case "bound":
      return "positive";
    case "pending":
    case "creating":
    case "progressing":
    case "binding":
    case "restarting":
    case "starting":
    case "stopping":
    case "updating":
    case "unknown":
      return "progress";
    case "failed":
    case "error":
    case "degraded":
    case "deleting":
    case "unavailable":
      return "negative";
    default:
      return "neutral";
  }
}

async function listProjectStatuses(
  actor: ProjectManagementActor
): Promise<ReadonlyMap<string, ProjectAggregateStatus> | null> {
  const fetchImpl: ProjectDeleteFetch = fetch;
  const request = async (path: string) => {
    const url = apiUrl(path, {
      "label-selector": BRAIN_PROJECT_ID_LABEL,
      namespace: actor.namespace,
    });
    if (url === null) {
      return null;
    }
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(actor.encodedKubeconfig),
      },
    });
    if (!response.ok) {
      return null;
    }
    return listItems(await response.json());
  };
  const [aps, dbs] = await Promise.all([
    request(API_ROUTES.ap.root),
    request(API_ROUTES.db.root),
  ]);
  if (aps === null && dbs === null) {
    return null;
  }
  const statuses = new Map<
    string,
    Exclude<ProjectAggregateStatus, "unknown">
  >();
  for (const resource of [...(aps ?? []), ...(dbs ?? [])]) {
    if (resource == null || typeof resource !== "object") {
      continue;
    }
    const value = resource as {
      metadata?: { labels?: Record<string, unknown> };
      spec?: { paused?: unknown };
      status?: { phase?: unknown };
    };
    const projectId = value.metadata?.labels?.[BRAIN_PROJECT_ID_LABEL];
    if (typeof projectId !== "string" || projectId === "") {
      continue;
    }
    const next = phaseStatus(value.status?.phase, value.spec?.paused === true);
    const current = statuses.get(projectId);
    if (current === undefined || TONE_SEVERITY[next] > TONE_SEVERITY[current]) {
      statuses.set(projectId, next);
    }
  }
  return statuses;
}

export async function listManagedProjects(
  actor: ProjectManagementActor
): Promise<ManagedProject[]> {
  const [projects, statuses] = await Promise.all([
    listProjects(actor.namespace),
    listProjectStatuses(actor).catch(() => null),
  ]);
  return projects.map((project) => ({
    ...project,
    aggregateStatus: statuses?.get(project.id) ?? "unknown",
  }));
}

export function getManagedProject(input: {
  namespace: string;
  projectId: string;
}): Promise<BrainProject | null> {
  return getProject(input.namespace, input.projectId);
}

export async function previewManagedProjectDeletion(
  actor: ProjectManagementActor,
  projectId: string
): Promise<ProjectDeletionPreview | null> {
  const project = await getProject(actor.namespace, projectId);
  if (project === null) {
    return null;
  }
  const resourceSummary = sortedSummary(
    await inspectProjectManagedResources({
      encodedKubeconfig: actor.encodedKubeconfig,
      id: projectId,
      namespace: actor.namespace,
    })
  );
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  const previewId = randomUUID();
  await getProjectDb()
    .delete(projectDeletePreviews)
    .where(lt(projectDeletePreviews.expiresAt, now));
  await getProjectDb()
    .insert(projectDeletePreviews)
    .values({
      actorUid: actor.actorUid,
      chatId: actor.chatId,
      createdAt: now,
      displayName: project.displayName,
      expiresAt,
      fingerprint: resourceSummaryFingerprint(resourceSummary),
      id: previewId,
      namespace: actor.namespace,
      projectId,
      resourceSummary,
    });
  await auditEvent({
    actor,
    displayName: project.displayName,
    projectId,
    resourceSummary,
    status: "previewed",
  });
  return {
    expiresAt: expiresAt.toISOString(),
    fingerprint: resourceSummaryFingerprint(resourceSummary),
    previewId,
    project,
    resourceSummary,
  };
}

async function claimDeletionOperation(input: {
  actor: ProjectManagementActor;
  previewId: string;
  projectId: string;
}): Promise<boolean> {
  const now = new Date();
  await getProjectDb()
    .delete(projectDeleteOperations)
    .where(
      and(
        eq(projectDeleteOperations.namespace, input.actor.namespace),
        eq(projectDeleteOperations.projectId, input.projectId),
        lt(projectDeleteOperations.expiresAt, now)
      )
    );
  const [operation] = await getProjectDb()
    .insert(projectDeleteOperations)
    .values({
      actorUid: input.actor.actorUid,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
      namespace: input.actor.namespace,
      previewId: input.previewId,
      projectId: input.projectId,
    })
    .onConflictDoNothing()
    .returning();
  return operation !== undefined;
}

async function releaseDeletionOperation(
  actor: ProjectManagementActor,
  projectId: string,
  previewId: string
) {
  await getProjectDb()
    .delete(projectDeleteOperations)
    .where(
      and(
        eq(projectDeleteOperations.namespace, actor.namespace),
        eq(projectDeleteOperations.projectId, projectId),
        eq(projectDeleteOperations.actorUid, actor.actorUid),
        eq(projectDeleteOperations.previewId, previewId)
      )
    );
}

export async function deleteManagedProject(input: {
  actor: ProjectManagementActor;
  previewId: string;
  projectId: string;
}): Promise<DeleteManagedProjectResult> {
  const now = new Date();
  const [preview] = await getProjectDb()
    .select()
    .from(projectDeletePreviews)
    .where(
      and(
        eq(projectDeletePreviews.id, input.previewId),
        eq(projectDeletePreviews.actorUid, input.actor.actorUid),
        eq(projectDeletePreviews.chatId, input.actor.chatId),
        eq(projectDeletePreviews.namespace, input.actor.namespace),
        eq(projectDeletePreviews.projectId, input.projectId),
        gt(projectDeletePreviews.expiresAt, now),
        isNull(projectDeletePreviews.consumedAt)
      )
    )
    .limit(1);
  if (preview === undefined) {
    return { code: "invalid_preview", ok: false };
  }
  const [consumedPreview] = await getProjectDb()
    .update(projectDeletePreviews)
    .set({ consumedAt: now })
    .where(
      and(
        eq(projectDeletePreviews.id, input.previewId),
        eq(projectDeletePreviews.actorUid, input.actor.actorUid),
        eq(projectDeletePreviews.chatId, input.actor.chatId),
        eq(projectDeletePreviews.namespace, input.actor.namespace),
        eq(projectDeletePreviews.projectId, input.projectId),
        gt(projectDeletePreviews.expiresAt, now),
        isNull(projectDeletePreviews.consumedAt)
      )
    )
    .returning({ id: projectDeletePreviews.id });
  if (consumedPreview === undefined) {
    return { code: "invalid_preview", ok: false };
  }
  const project = await getProject(input.actor.namespace, input.projectId);
  if (project === null) {
    await auditEvent({
      actor: input.actor,
      displayName: preview.displayName,
      failureCode: "project_not_found",
      projectId: input.projectId,
      resourceSummary: preview.resourceSummary,
      status: "stale",
    });
    return { code: "stale_preview", ok: false };
  }
  const currentSummary = sortedSummary(
    await inspectProjectManagedResources({
      encodedKubeconfig: input.actor.encodedKubeconfig,
      id: input.projectId,
      namespace: input.actor.namespace,
    })
  );
  if (
    project.displayName !== preview.displayName ||
    resourceSummaryFingerprint(currentSummary) !==
      resourceSummaryFingerprint(preview.resourceSummary)
  ) {
    await auditEvent({
      actor: input.actor,
      displayName: project.displayName,
      failureCode: "preview_stale",
      projectId: input.projectId,
      resourceSummary: currentSummary,
      status: "stale",
    });
    return { code: "stale_preview", ok: false };
  }
  if (!(await claimDeletionOperation(input))) {
    return { code: "deletion_in_progress", ok: false };
  }
  await auditEvent({
    actor: input.actor,
    displayName: project.displayName,
    projectId: input.projectId,
    resourceSummary: currentSummary,
    status: "started",
  });
  try {
    const deletedSummary = await deleteProjectManagedResources({
      encodedKubeconfig: input.actor.encodedKubeconfig,
      id: input.projectId,
      namespace: input.actor.namespace,
    });
    await deleteProject({
      id: input.projectId,
      namespace: input.actor.namespace,
    });
    await auditEvent({
      actor: input.actor,
      displayName: project.displayName,
      projectId: input.projectId,
      resourceSummary: deletedSummary,
      status: "completed",
    });
    return { ok: true, project, resourceSummary: deletedSummary };
  } catch {
    await auditEvent({
      actor: input.actor,
      displayName: project.displayName,
      failureCode: "cleanup_failed",
      projectId: input.projectId,
      resourceSummary: currentSummary,
      status: "failed",
    });
    throw new Error(
      "Project cleanup failed. Re-preview the Project and retry."
    );
  } finally {
    await releaseDeletionOperation(
      input.actor,
      input.projectId,
      input.previewId
    );
  }
}
