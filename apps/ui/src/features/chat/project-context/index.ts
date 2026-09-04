import "server-only";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { ApiUrl } from "@workspace/api/utils";
import type { DeployTaskStatus } from "@/features/deploy/task/schema";
import { listDeployTasks } from "@/features/deploy/task/service";
import type { DeployTaskDTO } from "@/features/deploy/task/types";
import { projectRuntimeFactsFromResources } from "@/features/project-canvas/runtime/resource-facts";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import {
  type BrainProject,
  getProject,
} from "@/lib/project-persistence/projects";
import { asRecord } from "@/lib/unknown-record";

const ACTIVE_TASK_STATUSES = [
  "queued",
  "running",
  "blocked",
  "applying",
] as const satisfies readonly DeployTaskStatus[];
const HISTORY_TASK_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly DeployTaskStatus[];
const DEFAULT_RESULT_LIMIT = 40;
const MAX_RESULT_LIMIT = 100;

type ProjectContextTaskRecord = Pick<
  DeployTaskDTO,
  | "artifactSummary"
  | "canvasProjection"
  | "completedAt"
  | "createdAt"
  | "id"
  | "namespace"
  | "phase"
  | "projectId"
  | "source"
  | "status"
>;

interface ProjectContextTaskList {
  nextCursor: string | null;
  tasks: ProjectContextTaskRecord[];
}

export interface ProjectContextIndexDependencies {
  listProjectResources(input: {
    kubeconfig: string;
    namespace: string;
    projectId: string;
  }): Promise<{ aps: unknown[]; dbs: unknown[] }>;
  listTasks(input: {
    limit: number;
    namespace: string;
    projectId: string;
    status: DeployTaskStatus[];
  }): Promise<ProjectContextTaskList>;
  readProject(input: {
    namespace: string;
    projectId: string;
    workspaceActor: string;
  }): Promise<BrainProject | null>;
}

export interface BuildProjectContextIndexInput {
  kubeconfig: string;
  limit?: number;
  namespace: string;
  projectId: string;
  workspaceActor: string;
}

export interface ProjectContextResourceRef {
  kind: "AP" | "DB";
  name: string;
  namespace: string;
  observedUid?: string;
}

export interface ProjectContextIndex {
  activeDeploymentTasks: ProjectContextPage<ProjectContextDeploymentTask>;
  contents: ProjectContextPage<ProjectContextContent>;
  deploymentHistory: ProjectContextPage<ProjectContextDeploymentTask>;
  project: {
    capabilities: [
      "discoverResources",
      "discoverDeployments",
      "discoverContents",
    ];
    description?: string;
    displayName: string;
    ref: { id: string; kind: "Project"; namespace: string };
  };
  resources: ProjectContextPage<ProjectContextResource>;
  version: 1;
}

interface ProjectContextPage<T> {
  items: T[];
  nextCursor?: string;
  truncated: boolean;
}

interface ProjectContextResource {
  capabilities: ["readDetails", "draftChange", "requestChange"];
  displayName: string;
  ref: ProjectContextResourceRef;
  status: { label: string; tone?: string };
}

interface ProjectContextDeploymentTask {
  capabilities: ["readStatus", "readTimeline"];
  completedAt?: string;
  createdAt: string;
  phase: ProjectContextTaskRecord["phase"];
  ref: {
    id: string;
    kind: "DeploymentTask";
    namespace: string;
    projectId: string;
  };
  resultRefs: {
    kind: "AP" | "DB" | "PublicAccess";
    name: string;
    namespace: string;
  }[];
  source: ProjectContextTaskSource;
  status: ProjectContextTaskRecord["status"];
}

type ProjectContextTaskSource =
  | { kind: "database" }
  | { kind: "docker" }
  | { branch?: string; kind: "github"; repository: string }
  | { kind: "prompt" }
  | { kind: "template"; templateName: string };

interface ProjectContextContent {
  capabilities: ["read"];
  ref: { kind: "ProjectContent"; uri: string };
  source: { taskId: string; templateName: string };
  title: string;
  trust: "untrusted-content";
  type: "template-readme";
}

export class ProjectContextUnavailableError extends Error {
  constructor() {
    super("Project context is unavailable.");
    this.name = "ProjectContextUnavailableError";
  }
}

function boundedLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_RESULT_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_RESULT_LIMIT);
}

function metadata(resource: unknown): Record<string, unknown> {
  return asRecord(asRecord(resource)?.metadata) ?? {};
}

function belongsToProject(
  resource: unknown,
  input: { namespace: string; projectId: string }
): boolean {
  const resourceMetadata = metadata(resource);
  const labels = asRecord(resourceMetadata.labels);
  const namespace = resourceMetadata.namespace;
  return (
    labels?.[BRAIN_PROJECT_ID_LABEL] === input.projectId &&
    namespace === input.namespace
  );
}

async function listProjectResources(input: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<{ aps: unknown[]; dbs: unknown[] }> {
  const read = async (path: string) =>
    fetcher<K8sGetResponse>({
      base: ApiUrl(),
      header: { Authorization: kubeconfigBearerHeader(input.kubeconfig) },
      method: "GET",
      path,
      query: {
        "label-selector": `${BRAIN_PROJECT_ID_LABEL}=${input.projectId}`,
        namespace: input.namespace,
      },
    });
  const [aps, dbs] = await Promise.all([
    read(API_ROUTES.ap.root),
    read(API_ROUTES.db.root),
  ]);
  return { aps: apItemsFromList(aps), dbs: apItemsFromList(dbs) };
}

const DEFAULT_DEPENDENCIES: ProjectContextIndexDependencies = {
  listProjectResources,
  listTasks: listDeployTasks,
  // The Chat request has already verified this actor against the Namespace.
  // Projects are Namespace-shared (ADR-0056/0059), so this second lookup
  // verifies stable Project identity rather than imposing personal ownership.
  readProject: ({ namespace, projectId }) => getProject(namespace, projectId),
};

function resourcePage(
  resources: { aps: unknown[]; dbs: unknown[] },
  input: { limit: number; namespace: string; projectId: string }
): ProjectContextPage<ProjectContextResource> {
  const facts = projectRuntimeFactsFromResources({
    apsData: {
      items: resources.aps.filter((resource) =>
        belongsToProject(resource, input)
      ),
    },
    dbsData: {
      items: resources.dbs.filter((resource) =>
        belongsToProject(resource, input)
      ),
    },
    namespace: input.namespace,
  });
  const items = [
    ...facts.apFacts.map(
      (fact): ProjectContextResource => ({
        capabilities: ["readDetails", "draftChange", "requestChange"],
        displayName: fact.displayName,
        ref: {
          ...fact.ref,
          ...(fact.observedUid ? { observedUid: fact.observedUid } : {}),
        },
        status: fact.status,
      })
    ),
    ...facts.dbFacts.map(
      (fact): ProjectContextResource => ({
        capabilities: ["readDetails", "draftChange", "requestChange"],
        displayName: fact.displayName,
        ref: {
          ...fact.ref,
          ...(fact.observedUid ? { observedUid: fact.observedUid } : {}),
        },
        status: fact.status,
      })
    ),
  ].sort((a, b) => {
    const aKey = `${a.ref.kind}:${a.ref.namespace}:${a.ref.name}`;
    const bKey = `${b.ref.kind}:${b.ref.namespace}:${b.ref.name}`;
    return aKey.localeCompare(bKey);
  });
  return {
    items: items.slice(0, input.limit),
    truncated: items.length > input.limit,
  };
}

function taskSource(
  source: ProjectContextTaskRecord["source"]
): ProjectContextTaskSource {
  switch (source.kind) {
    case "github":
      return {
        ...(source.branch?.trim() ? { branch: source.branch.trim() } : {}),
        kind: "github",
        repository: source.repo.fullName,
      };
    case "template":
      return { kind: "template", templateName: source.templateName };
    case "database":
    case "docker":
    case "prompt":
      return { kind: source.kind };
    default:
      return source satisfies never;
  }
}

function taskResultRefs(
  task: ProjectContextTaskRecord,
  namespace: string
): ProjectContextDeploymentTask["resultRefs"] {
  const refs = [
    ...(task.canvasProjection.resultMappings ?? []).map(
      (mapping) => mapping.actualRef
    ),
    ...(task.artifactSummary.resources ?? []),
  ];
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    if (
      ref.namespace !== namespace ||
      !["AP", "DB", "PublicAccess"].includes(ref.kind)
    ) {
      return [];
    }
    const typed = ref as ProjectContextDeploymentTask["resultRefs"][number];
    const key = `${typed.kind}:${typed.namespace}:${typed.name}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [typed];
  });
}

function taskPage(
  result: ProjectContextTaskList,
  input: { namespace: string; projectId: string }
): ProjectContextPage<ProjectContextDeploymentTask> {
  const items = result.tasks
    .filter(
      (task) =>
        task.namespace === input.namespace && task.projectId === input.projectId
    )
    .map(
      (task): ProjectContextDeploymentTask => ({
        capabilities: ["readStatus", "readTimeline"],
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        createdAt: task.createdAt,
        phase: task.phase,
        ref: {
          id: task.id,
          kind: "DeploymentTask",
          namespace: task.namespace,
          projectId: task.projectId as string,
        },
        resultRefs: taskResultRefs(task, input.namespace),
        source: taskSource(task.source),
        status: task.status,
      })
    );
  return {
    items,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    truncated: result.nextCursor !== null,
  };
}

function contentPage(
  tasks: readonly ProjectContextTaskRecord[],
  limit: number,
  hasMoreTasks: boolean
): ProjectContextPage<ProjectContextContent> {
  const seen = new Set<string>();
  const allItems = tasks.flatMap((task): ProjectContextContent[] => {
    if (task.source.kind !== "template" || seen.has(task.id)) {
      return [];
    }
    seen.add(task.id);
    return [
      {
        capabilities: ["read"],
        ref: {
          kind: "ProjectContent",
          uri: `project-content://deployment-task/${encodeURIComponent(task.id)}/template-readme`,
        },
        source: { taskId: task.id, templateName: task.source.templateName },
        title: `${task.source.templateName} README`,
        trust: "untrusted-content",
        type: "template-readme",
      },
    ];
  });
  return {
    items: allItems.slice(0, limit),
    truncated: hasMoreTasks || allItems.length > limit,
  };
}

export async function buildProjectContextIndex(
  input: BuildProjectContextIndexInput,
  dependencies: ProjectContextIndexDependencies = DEFAULT_DEPENDENCIES
): Promise<ProjectContextIndex> {
  const namespace = input.namespace.trim();
  const projectId = input.projectId.trim();
  const workspaceActor = input.workspaceActor.trim();
  if (!(namespace && projectId && workspaceActor)) {
    throw new ProjectContextUnavailableError();
  }
  const project = await dependencies.readProject({
    namespace,
    projectId,
    workspaceActor,
  });
  if (
    project == null ||
    project.id !== projectId ||
    project.namespace !== namespace
  ) {
    throw new ProjectContextUnavailableError();
  }

  const limit = boundedLimit(input.limit);
  const [resources, activeTasks, historyTasks] = await Promise.all([
    dependencies.listProjectResources({
      kubeconfig: input.kubeconfig,
      namespace,
      projectId,
    }),
    dependencies.listTasks({
      limit,
      namespace,
      projectId,
      status: [...ACTIVE_TASK_STATUSES],
    }),
    dependencies.listTasks({
      limit,
      namespace,
      projectId,
      status: [...HISTORY_TASK_STATUSES],
    }),
  ]);
  const safeActiveTasks = activeTasks.tasks.filter(
    (task) => task.namespace === namespace && task.projectId === projectId
  );
  const safeHistoryTasks = historyTasks.tasks.filter(
    (task) => task.namespace === namespace && task.projectId === projectId
  );

  return {
    activeDeploymentTasks: taskPage(activeTasks, { namespace, projectId }),
    contents: contentPage(
      [...safeActiveTasks, ...safeHistoryTasks],
      limit,
      activeTasks.nextCursor !== null || historyTasks.nextCursor !== null
    ),
    deploymentHistory: taskPage(historyTasks, { namespace, projectId }),
    project: {
      capabilities: [
        "discoverResources",
        "discoverDeployments",
        "discoverContents",
      ],
      ...(project.description.trim()
        ? { description: project.description }
        : {}),
      displayName: project.displayName,
      ref: { id: project.id, kind: "Project", namespace: project.namespace },
    },
    resources: resourcePage(resources, { limit, namespace, projectId }),
    version: 1,
  };
}
