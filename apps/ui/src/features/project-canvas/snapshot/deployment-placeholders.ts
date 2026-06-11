import type { Node } from "@xyflow/react";
import type { DeployTaskDTO } from "@/lib/deploy-task/types";
import type {
  CanvasLayoutDocument,
  CanvasLayoutPosition,
  CanvasLayoutResourceKind,
  CanvasLayoutResourceRef,
} from "../layout/types";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import type { CanvasDeploymentPlaceholderRfNode } from "../nodes/types";

export const DEPLOYMENT_PLACEHOLDER_COMPLETED_GRACE_MS = 60_000;

const ACTIVE_DEPLOY_TASK_STATUSES = new Set([
  "queued",
  "running",
  "blocked",
  "applying",
]);

function sanitizeNodeIdPart(value: string): string {
  return value.replace(/\s+/g, "-");
}

function finitePosition(
  position: DeployTaskDTO["canvasProjection"]["position"]
): CanvasLayoutPosition | undefined {
  if (
    position == null ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return undefined;
  }
  return { x: position.x, y: position.y };
}

function completedAtMs(task: DeployTaskDTO): number | undefined {
  if (task.completedAt == null) {
    return undefined;
  }
  const ms = Date.parse(task.completedAt);
  return Number.isFinite(ms) ? ms : undefined;
}

function taskWithinCompletedGrace(task: DeployTaskDTO, now: Date): boolean {
  const completedMs = completedAtMs(task);
  return (
    completedMs !== undefined &&
    now.getTime() - completedMs <= DEPLOYMENT_PLACEHOLDER_COMPLETED_GRACE_MS
  );
}

function taskHasResultResources(task: DeployTaskDTO): boolean {
  return (task.artifactSummary.resources?.length ?? 0) > 0;
}

export function shouldShowDeploymentPlaceholder(
  task: DeployTaskDTO,
  now = new Date()
): boolean {
  const projectId = task.projectId?.trim();
  if (!projectId) {
    return false;
  }
  if (ACTIVE_DEPLOY_TASK_STATUSES.has(task.status)) {
    return true;
  }
  if (task.status !== "completed") {
    return false;
  }
  return taskHasResultResources(task) && taskWithinCompletedGrace(task, now);
}

export function deploymentPlaceholderNodeId(taskId: string): string {
  return `deployment-placeholder-${sanitizeNodeIdPart(taskId)}`;
}

export function isDeploymentPlaceholderNode(
  node: Node | undefined
): node is CanvasDeploymentPlaceholderRfNode {
  return node?.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE;
}

export function deploymentPlaceholderTaskIdFromNode(
  node: Node | undefined
): string | undefined {
  return isDeploymentPlaceholderNode(node) ? node.data.taskId : undefined;
}

export function deploymentPlaceholderNodesFromTasks(
  tasks: readonly DeployTaskDTO[] | undefined,
  now = new Date()
): CanvasDeploymentPlaceholderRfNode[] {
  if (tasks == null) {
    return [];
  }
  return tasks
    .filter((task) => shouldShowDeploymentPlaceholder(task, now))
    .map((task, index) => {
      const projectionPosition = finitePosition(task.canvasProjection.position);
      return {
        data: {
          hasProjectionPosition: projectionPosition !== undefined,
          taskId: task.id,
        },
        id: deploymentPlaceholderNodeId(task.id),
        position: projectionPosition ?? {
          x: index * 340,
          y: 0,
        },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      };
    });
}

function normalizeResourceKind(kind: string): CanvasLayoutResourceKind | null {
  switch (kind.trim().toLowerCase()) {
    case "ap":
      return "AP";
    case "db":
      return "DB";
    default:
      return null;
  }
}

interface DeploymentTaskTemplateNativeResultRef {
  kind: "TemplateNative";
  name: string;
  namespace: string;
}

type DeploymentTaskResultResourceRef =
  | CanvasLayoutResourceRef
  | DeploymentTaskTemplateNativeResultRef;

function taskResultResourceRefs(
  task: DeployTaskDTO
): DeploymentTaskResultResourceRef[] {
  const refs: DeploymentTaskResultResourceRef[] = [];
  for (const resource of task.artifactSummary.resources ?? []) {
    const name = resource.name.trim();
    const namespace = resource.namespace.trim();
    if (name === "" || namespace === "") {
      continue;
    }
    const kind = normalizeResourceKind(resource.kind);
    refs.push({ kind: kind ?? "TemplateNative", name, namespace });
  }
  return refs;
}

function primaryResultRef(
  refs: readonly DeploymentTaskResultResourceRef[]
): DeploymentTaskResultResourceRef | undefined {
  return (
    refs.find((ref) => ref.kind === "AP") ??
    refs.find((ref) => ref.kind === "DB") ??
    refs.find((ref) => ref.kind === "TemplateNative")
  );
}

function layoutHasRef(
  layout: CanvasLayoutDocument | undefined,
  ref: CanvasLayoutResourceRef
): boolean {
  const key = canvasResourceKey(ref);
  return (layout?.nodes ?? []).some(
    (node) => canvasResourceKey(node.ref) === key
  );
}

export function deploymentPlaceholderHandoffs(input: {
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  tasks?: readonly DeployTaskDTO[];
}): {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
} {
  const nodesByRef = new Map(
    input.nodes.flatMap((node) => {
      const ref = canvasResourceIdentityFromNode(node);
      return ref === undefined ? [] : [[canvasResourceKey(ref), node] as const];
    })
  );
  const nodesByTemplateKey = new Map(
    input.nodes.flatMap((node) => {
      const data = node.data as Record<string, unknown> | undefined;
      const states = data?.states as Record<string, unknown> | undefined;
      const namespace = states?.namespace;
      const name = states?.name;
      return data?.resourceKind === "template" &&
        typeof namespace === "string" &&
        typeof name === "string"
        ? [[`${namespace}/${name}`, node] as const]
        : [];
    })
  );
  const byNodeId = new Map<string, CanvasLayoutPosition>();
  const byRef = new Map<string, CanvasLayoutPosition>();
  for (const task of input.tasks ?? []) {
    const position = finitePosition(task.canvasProjection.position);
    if (position === undefined) {
      continue;
    }
    const primary = primaryResultRef(taskResultResourceRefs(task));
    if (primary === undefined) {
      continue;
    }
    if (primary.kind === "TemplateNative") {
      const node = nodesByTemplateKey.get(
        `${primary.namespace}/${primary.name}`
      );
      if (node !== undefined) {
        byNodeId.set(node.id, position);
      }
      continue;
    }
    if (layoutHasRef(input.layout, primary)) {
      continue;
    }
    if (nodesByRef.has(canvasResourceKey(primary))) {
      byRef.set(canvasResourceKey(primary), position);
    }
  }
  return { byNodeId, byRef };
}

export function shouldHideDeploymentPlaceholderForHandoff(input: {
  nodes: readonly Node[];
  task: DeployTaskDTO;
}): boolean {
  const refs = taskResultResourceRefs(input.task);
  if (refs.length === 0) {
    return false;
  }
  const nodeKeys = new Set(
    input.nodes.flatMap((node) => {
      const ref = canvasResourceIdentityFromNode(node);
      return ref === undefined ? [] : [canvasResourceKey(ref)];
    })
  );
  const templateKeys = new Set(
    input.nodes.flatMap((node) => {
      const data = node.data as Record<string, unknown> | undefined;
      const states = data?.states as Record<string, unknown> | undefined;
      const namespace = states?.namespace;
      const name = states?.name;
      return data?.resourceKind === "template" &&
        typeof namespace === "string" &&
        typeof name === "string"
        ? [`${namespace}/${name}`]
        : [];
    })
  );
  return refs.some((ref) =>
    ref.kind === "TemplateNative"
      ? templateKeys.has(`${ref.namespace}/${ref.name}`)
      : nodeKeys.has(canvasResourceKey(ref))
  );
}
