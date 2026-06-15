import type { Edge, Node } from "@xyflow/react";
import YAML from "yaml";
import { resolveApEnvRawSourceReferences } from "@/features/project-settings/ap/lib/ap-env-raw-source";
import type { ApEnvDbDsnSource } from "@/features/project-settings/ap/lib/ap-env-rows";
import {
  DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS,
  type DeploymentTaskProjection,
  deploymentTaskProjectionIsVisible,
} from "@/lib/deploy-task/projection";
import type {
  DeploymentTaskCanvasProjectionEdge,
  DeploymentTaskCanvasProjectionExpectedRef,
  DeploymentTaskCanvasProjectionSlot,
} from "@/lib/deploy-task/types";
import {
  COLUMN_STEP,
  PUBLIC_ACCESS_AP_LEFT_OFFSET,
  ROW_STEP,
} from "../layout/placement-geometry";
import {
  canvasLayoutNodeFromOwner,
  canvasLayoutNodeKey,
  canvasLayoutNodeResourceRef,
  canvasPlacementOwnerKey,
  DEPLOYMENT_UNKNOWN_SLOT_ID,
  deploymentProjectionPlacementOwner,
  resourcePlacementOwner,
} from "../layout/placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutResourceKind,
  CanvasLayoutResourceRef,
  CanvasPlacementSource,
  PlacementCommand,
} from "../layout/types";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";

export const DEPLOYMENT_PLACEHOLDER_COMPLETED_GRACE_MS =
  DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS;

interface DeploymentTaskTemplateNativeResultRef {
  kind: "TemplateNative";
  name: string;
  namespace: string;
}

type DeploymentTaskResultResourceRef =
  | CanvasLayoutResourceRef
  | DeploymentTaskTemplateNativeResultRef;

interface DeploymentResultPreview {
  edges: DeploymentTaskCanvasProjectionEdge[];
  slots: DeploymentTaskCanvasProjectionSlot[];
}

interface DeploymentProjectionPlacement {
  persisted: boolean;
  position: CanvasLayoutPosition;
  source?: CanvasPlacementSource;
}

function sanitizeNodeIdPart(value: string): string {
  return value.replace(/\s+/g, "-");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function layoutNodeByOwner(
  layout: CanvasLayoutDocument | undefined
): Map<string, CanvasLayoutNode> {
  return new Map(
    (layout?.nodes ?? []).map((node) => [canvasLayoutNodeKey(node), node])
  );
}

function deploymentSlotOwnerKey(taskId: string, slotId: string): string {
  return canvasPlacementOwnerKey(
    deploymentProjectionPlacementOwner({ slotId, taskId })
  );
}

function resourceOwnerKey(ref: CanvasLayoutResourceRef): string {
  return canvasPlacementOwnerKey(resourcePlacementOwner(ref));
}

function deploymentProjectionPlacement(input: {
  layout?: CanvasLayoutDocument;
  slotId: string;
  taskId: string;
}): DeploymentProjectionPlacement | undefined {
  const node = layoutNodeByOwner(input.layout).get(
    deploymentSlotOwnerKey(input.taskId, input.slotId)
  );
  if (node === undefined) {
    return undefined;
  }
  return {
    persisted: true,
    position: { x: node.position.x, y: node.position.y },
    ...(node.source === undefined ? {} : { source: node.source }),
  };
}

function unknownSlotProjectionPlacement(input: {
  layout?: CanvasLayoutDocument;
  task: DeploymentTaskProjection;
}): DeploymentProjectionPlacement | undefined {
  return deploymentProjectionPlacement({
    layout: input.layout,
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
}

function slotProjectionPlacement(input: {
  layout?: CanvasLayoutDocument;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
}): DeploymentProjectionPlacement | undefined {
  return deploymentProjectionPlacement({
    layout: input.layout,
    slotId: input.slot.id,
    taskId: input.task.id,
  });
}

function normalizeArtifactResourceKind(
  kind: string
): CanvasLayoutResourceKind | null {
  switch (kind.trim().toLowerCase()) {
    case "ap":
    case "app":
    case "application":
    case "deployment":
    case "deployments":
    case "statefulset":
    case "statefulsets":
      return "AP";
    case "db":
    case "database":
    case "cluster":
    case "clusters":
    case "kubeblockscluster":
      return "DB";
    default:
      return null;
  }
}

function expectedRefKey(
  ref: DeploymentTaskCanvasProjectionExpectedRef
): string {
  return `${ref.kind}:${ref.namespace}:${ref.name}`;
}

function expectedRefToLayoutRef(
  ref: DeploymentTaskCanvasProjectionExpectedRef | undefined
): CanvasLayoutResourceRef | undefined {
  if (
    ref?.kind === "AP" ||
    ref?.kind === "DB" ||
    ref?.kind === "PublicAccess"
  ) {
    return { kind: ref.kind, name: ref.name, namespace: ref.namespace };
  }
  return undefined;
}

function expectedRefToResultRef(
  ref: DeploymentTaskCanvasProjectionExpectedRef | undefined
): DeploymentTaskResultResourceRef | undefined {
  if (ref == null) {
    return undefined;
  }
  if (ref.kind === "TemplateNative") {
    return ref;
  }
  return expectedRefToLayoutRef(ref);
}

function resultRefForSlot(input: {
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
}): DeploymentTaskResultResourceRef | undefined {
  const resultMappings =
    input.task.resultMappings ?? input.task.canvasProjection.resultMappings;
  const mapped = resultMappings?.find(
    (mapping) => mapping.slotId === input.slot.id
  );
  return expectedRefToResultRef(mapped?.actualRef ?? input.slot.expectedRef);
}

function layoutRefForSlot(input: {
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
}): CanvasLayoutResourceRef | undefined {
  const resultMappings =
    input.task.resultMappings ?? input.task.canvasProjection.resultMappings;
  const mapped = resultMappings?.find(
    (mapping) => mapping.slotId === input.slot.id
  );
  return expectedRefToLayoutRef(mapped?.actualRef ?? input.slot.expectedRef);
}

function taskResultResourceRefs(
  task: DeploymentTaskProjection
): DeploymentTaskResultResourceRef[] {
  const refs: DeploymentTaskResultResourceRef[] = [];
  for (const resource of task.artifactSummary.resources ?? []) {
    const name = resource.name.trim();
    const namespace = resource.namespace.trim();
    if (name === "" || namespace === "") {
      continue;
    }
    const kind = normalizeArtifactResourceKind(resource.kind);
    if (kind === null) {
      continue;
    }
    refs.push({ kind, name, namespace });
  }
  return refs;
}

function layoutHasRef(
  layout: CanvasLayoutDocument | undefined,
  ref: CanvasLayoutResourceRef
): boolean {
  const key = canvasResourceKey(ref);
  return (layout?.nodes ?? []).some((node) => {
    const resourceRef = canvasLayoutNodeResourceRef(node);
    return resourceRef !== undefined && canvasResourceKey(resourceRef) === key;
  });
}

function templateNodeKeyFromNode(node: Node): string | undefined {
  const data = node.data as Record<string, unknown> | undefined;
  const states = data?.states as Record<string, unknown> | undefined;
  const namespace = states?.namespace;
  const name = states?.name;
  return data?.resourceKind === "template" &&
    typeof namespace === "string" &&
    typeof name === "string"
    ? `${namespace}/${name}`
    : undefined;
}

function nodesByRef(nodes: readonly Node[]): Map<string, Node> {
  return new Map(
    nodes.flatMap((node) => {
      const ref = canvasResourceIdentityFromNode(node);
      return ref === undefined ? [] : [[canvasResourceKey(ref), node] as const];
    })
  );
}

function nodesByTemplateKey(nodes: readonly Node[]): Map<string, Node> {
  return new Map(
    nodes.flatMap((node) => {
      const key = templateNodeKeyFromNode(node);
      return key === undefined ? [] : [[key, node] as const];
    })
  );
}

function nodeForResultRef(
  ref: DeploymentTaskResultResourceRef,
  nodes: readonly Node[]
): Node | undefined {
  if (ref.kind === "TemplateNative") {
    return nodesByTemplateKey(nodes).get(`${ref.namespace}/${ref.name}`);
  }
  return nodesByRef(nodes).get(canvasResourceKey(ref));
}

function resultRefHasLiveNode(
  ref: DeploymentTaskResultResourceRef,
  nodes: readonly Node[]
): boolean {
  return nodeForResultRef(ref, nodes) !== undefined;
}

function resultRefHasSavedLayout(
  ref: DeploymentTaskResultResourceRef,
  layout: CanvasLayoutDocument | undefined
): boolean {
  return ref.kind !== "TemplateNative" && layoutHasRef(layout, ref);
}

function projectionSlotNodeId(taskId: string, slotId: string): string {
  return `deployment-result-placeholder-${sanitizeNodeIdPart(taskId)}-${sanitizeNodeIdPart(slotId)}`;
}

export function deploymentPlaceholderNodeId(taskId: string): string {
  return `deployment-placeholder-${sanitizeNodeIdPart(taskId)}`;
}

export function isDeploymentPlaceholderNode(
  node: Node | undefined
): node is CanvasDeploymentPlaceholderRfNode {
  return node?.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE;
}

function hasProjectionSlotGroup(
  data: CanvasDeploymentPlaceholderNodeData
): data is CanvasDeploymentPlaceholderNodeData & {
  projectionSlots: NonNullable<
    CanvasDeploymentPlaceholderNodeData["projectionSlots"]
  >;
} {
  return Array.isArray(data.projectionSlots) && data.projectionSlots.length > 0;
}

export function deploymentPlaceholderTaskIdFromNode(
  node: Node | undefined
): string | undefined {
  return isDeploymentPlaceholderNode(node) ? node.data.taskId : undefined;
}

function yamlDocuments(
  task: DeploymentTaskProjection
): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const raw of task.artifactSummary.resourceYamls ?? []) {
    try {
      for (const doc of YAML.parseAllDocuments(raw)) {
        const parsed = doc.toJS();
        const record = asRecord(parsed);
        if (record !== undefined) {
          docs.push(record);
        }
      }
    } catch {
      // Invalid artifact YAML is handled by the deployment task; preview simply stays conservative.
    }
  }
  return docs;
}

function metadataRefFromDoc(
  doc: Record<string, unknown>
): { name: string; namespace: string } | undefined {
  const metadata = asRecord(doc.metadata);
  const name = nonEmptyString(metadata?.name);
  const namespace = nonEmptyString(metadata?.namespace);
  return name === undefined || namespace === undefined
    ? undefined
    : { name, namespace };
}

function apInputNetwork(
  doc: Record<string, unknown>
): Record<string, unknown> | undefined {
  return asRecord(asRecord(asRecord(doc.spec)?.input)?.network);
}

function apHasPublicAccessIntent(doc: Record<string, unknown>): boolean {
  const network = apInputNetwork(doc);
  return (
    (Array.isArray(network?.platformAddresses) &&
      network.platformAddresses.length > 0) ||
    (Array.isArray(network?.publicAddresses) &&
      network.publicAddresses.length > 0)
  );
}

function apEnvRawSource(doc: Record<string, unknown>): string | undefined {
  return nonEmptyString(asRecord(asRecord(doc.spec)?.input)?.envRawSource);
}

function slotIdForRef(ref: DeploymentTaskCanvasProjectionExpectedRef): string {
  return `${ref.kind}:${ref.namespace}:${ref.name}`;
}

function addSlot(
  slotsById: Map<string, DeploymentTaskCanvasProjectionSlot>,
  slot: DeploymentTaskCanvasProjectionSlot
): void {
  if (!slotsById.has(slot.id)) {
    slotsById.set(slot.id, slot);
  }
}

function addPreviewEdge(
  edgesByKey: Map<string, DeploymentTaskCanvasProjectionEdge>,
  edge: DeploymentTaskCanvasProjectionEdge
): void {
  const key = `${edge.sourceSlotId}->${edge.targetSlotId}`;
  if (!edgesByKey.has(key)) {
    edgesByKey.set(key, { ...edge, id: edge.id ?? key });
  }
}

function explicitPreview(
  task: DeploymentTaskProjection
): DeploymentResultPreview | undefined {
  const slots =
    task.canvasProjection.slots?.filter((slot) => slot.id.trim() !== "") ?? [];
  if (slots.length === 0) {
    return undefined;
  }
  return {
    edges: task.canvasProjection.edges ?? [],
    slots,
  };
}

function derivedPreview(
  task: DeploymentTaskProjection
): DeploymentResultPreview | undefined {
  const slotsById = new Map<string, DeploymentTaskCanvasProjectionSlot>();
  const edgesByKey = new Map<string, DeploymentTaskCanvasProjectionEdge>();
  addArtifactResourceSlots(slotsById, task);

  const dbSources = dbSourcesFromSlots(slotsById);
  for (const doc of yamlDocuments(task)) {
    addBrainApPreviewFromDoc({
      dbSources,
      doc,
      edgesByKey,
      slotsById,
    });
  }

  const slots = [...slotsById.values()];
  return slots.length === 0
    ? undefined
    : { edges: [...edgesByKey.values()], slots };
}

function expectedRefFromResultRef(
  ref: DeploymentTaskResultResourceRef
): DeploymentTaskCanvasProjectionExpectedRef {
  return ref.kind === "TemplateNative"
    ? ref
    : { kind: ref.kind, name: ref.name, namespace: ref.namespace };
}

function addArtifactResourceSlots(
  slotsById: Map<string, DeploymentTaskCanvasProjectionSlot>,
  task: DeploymentTaskProjection
): void {
  for (const ref of taskResultResourceRefs(task)) {
    const expectedRef = expectedRefFromResultRef(ref);
    addSlot(slotsById, {
      expectedRef,
      id: slotIdForRef(expectedRef),
    });
  }
}

function dbSourcesFromSlots(
  slotsById: ReadonlyMap<string, DeploymentTaskCanvasProjectionSlot>
): ApEnvDbDsnSource[] {
  return [...slotsById.values()].flatMap((slot) =>
    slot.expectedRef?.kind === "DB"
      ? [
          {
            name: slot.expectedRef.name,
            namespace: slot.expectedRef.namespace,
          },
        ]
      : []
  );
}

function addBrainApPublicAccessPreview(input: {
  apSlotId: string;
  edgesByKey: Map<string, DeploymentTaskCanvasProjectionEdge>;
  metadata: { name: string; namespace: string };
  slotsById: Map<string, DeploymentTaskCanvasProjectionSlot>;
}): void {
  const publicAccessRef: DeploymentTaskCanvasProjectionExpectedRef = {
    kind: "PublicAccess",
    name: input.metadata.name,
    namespace: input.metadata.namespace,
  };
  const publicAccessSlotId = slotIdForRef(publicAccessRef);
  addSlot(input.slotsById, {
    expectedRef: publicAccessRef,
    id: publicAccessSlotId,
  });
  addPreviewEdge(input.edgesByKey, {
    evidence: "ap-public-access-intent",
    sourceSlotId: publicAccessSlotId,
    targetSlotId: input.apSlotId,
  });
}

function addBrainApDbPreviewEdges(input: {
  apSlotId: string;
  dbSources: readonly ApEnvDbDsnSource[];
  doc: Record<string, unknown>;
  edgesByKey: Map<string, DeploymentTaskCanvasProjectionEdge>;
  slotsById: ReadonlyMap<string, DeploymentTaskCanvasProjectionSlot>;
}): void {
  const envRawSource = apEnvRawSource(input.doc);
  if (envRawSource === undefined || input.dbSources.length === 0) {
    return;
  }
  const resolved = resolveApEnvRawSourceReferences(
    envRawSource,
    input.dbSources
  );
  for (const reference of resolved.references) {
    const dbRef: DeploymentTaskCanvasProjectionExpectedRef = {
      kind: "DB",
      name: reference.canonicalDbName,
      namespace: reference.source.namespace,
    };
    const dbSlotId = slotIdForRef(dbRef);
    if (input.slotsById.has(dbSlotId)) {
      addPreviewEdge(input.edgesByKey, {
        evidence: "ap-env-raw-source-reference",
        sourceSlotId: input.apSlotId,
        targetSlotId: dbSlotId,
      });
    }
  }
}

function addBrainApPreviewFromDoc(input: {
  dbSources: readonly ApEnvDbDsnSource[];
  doc: Record<string, unknown>;
  edgesByKey: Map<string, DeploymentTaskCanvasProjectionEdge>;
  slotsById: Map<string, DeploymentTaskCanvasProjectionSlot>;
}): void {
  const apiVersion = nonEmptyString(input.doc.apiVersion);
  const kind = nonEmptyString(input.doc.kind);
  if (apiVersion !== "brain.io/direct" || kind !== "AP") {
    return;
  }
  const metadata = metadataRefFromDoc(input.doc);
  if (metadata === undefined) {
    return;
  }

  const apRef: DeploymentTaskCanvasProjectionExpectedRef = {
    kind: "AP",
    name: metadata.name,
    namespace: metadata.namespace,
  };
  const apSlotId = slotIdForRef(apRef);
  addSlot(input.slotsById, { expectedRef: apRef, id: apSlotId });

  if (apHasPublicAccessIntent(input.doc)) {
    addBrainApPublicAccessPreview({
      apSlotId,
      edgesByKey: input.edgesByKey,
      metadata,
      slotsById: input.slotsById,
    });
  }
  addBrainApDbPreviewEdges({
    apSlotId,
    dbSources: input.dbSources,
    doc: input.doc,
    edgesByKey: input.edgesByKey,
    slotsById: input.slotsById,
  });
}

function deploymentResultPreview(
  task: DeploymentTaskProjection
): DeploymentResultPreview | undefined {
  return explicitPreview(task) ?? derivedPreview(task);
}

function anchorSlot(slots: readonly DeploymentTaskCanvasProjectionSlot[]) {
  return (
    slots.find((slot) => slot.anchor === true) ??
    slots.find((slot) => slot.expectedRef?.kind === "AP") ??
    slots.find((slot) => slot.expectedRef?.kind === "DB") ??
    slots[0]
  );
}

function relativeSlotPositions(
  slots: readonly DeploymentTaskCanvasProjectionSlot[]
): Map<string, CanvasLayoutPosition> {
  const anchor = anchorSlot(slots);
  const anchorId = anchor?.id;
  const publicAccessForAnchor = slots.find(
    (slot) =>
      slot.expectedRef?.kind === "PublicAccess" &&
      anchor?.expectedRef?.kind === "AP" &&
      slot.expectedRef.namespace === anchor.expectedRef.namespace &&
      slot.expectedRef.name === anchor.expectedRef.name
  );
  const anchorX =
    publicAccessForAnchor === undefined ? 0 : PUBLIC_ACCESS_AP_LEFT_OFFSET;
  const positions = new Map<string, CanvasLayoutPosition>();
  if (publicAccessForAnchor !== undefined) {
    positions.set(publicAccessForAnchor.id, { x: 0, y: 0 });
  }
  if (anchorId !== undefined) {
    positions.set(anchorId, { x: anchorX, y: 0 });
  }

  let column = publicAccessForAnchor === undefined ? 1 : 2;
  let row = 0;
  for (const slot of slots) {
    if (positions.has(slot.id)) {
      continue;
    }
    positions.set(slot.id, {
      x: column * COLUMN_STEP,
      y: row * ROW_STEP,
    });
    row += 1;
    if (row >= 2) {
      row = 0;
      column += 1;
    }
  }
  return positions;
}

function materializedSlotPositions(input: {
  layout?: CanvasLayoutDocument;
  slots: readonly DeploymentTaskCanvasProjectionSlot[];
  task: DeploymentTaskProjection;
}): {
  positions: Map<string, CanvasLayoutPosition>;
  saved: Set<string>;
  relative: Map<string, CanvasLayoutPosition>;
} {
  const relative = relativeSlotPositions(input.slots);
  const positions = new Map<string, CanvasLayoutPosition>();
  const saved = new Set<string>();
  const origin = materializedSlotOrigin({
    layout: input.layout,
    relative,
    slots: input.slots,
    task: input.task,
  });
  for (const slot of input.slots) {
    const slotPlacement = slotProjectionPlacement({
      layout: input.layout,
      slot,
      task: input.task,
    });
    if (slotPlacement !== undefined) {
      positions.set(slot.id, slotPlacement.position);
      saved.add(slot.id);
      continue;
    }
    const slotRelative = relative.get(slot.id) ?? { x: 0, y: 0 };
    positions.set(slot.id, {
      x: origin.x + slotRelative.x,
      y: origin.y + slotRelative.y,
    });
  }
  return { positions, relative, saved };
}

function materializedSlotOrigin(input: {
  layout?: CanvasLayoutDocument;
  relative: ReadonlyMap<string, CanvasLayoutPosition>;
  slots: readonly DeploymentTaskCanvasProjectionSlot[];
  task: DeploymentTaskProjection;
}): CanvasLayoutPosition {
  const anchor = anchorSlot(input.slots);
  const unknownSlotPosition = unknownSlotProjectionPlacement({
    layout: input.layout,
    task: input.task,
  })?.position;
  const anchorRelative =
    anchor === undefined ? undefined : input.relative.get(anchor.id);
  const anchorPosition =
    anchor === undefined
      ? undefined
      : slotProjectionPlacement({
          layout: input.layout,
          slot: anchor,
          task: input.task,
        })?.position;
  if (anchorPosition !== undefined && anchorRelative !== undefined) {
    return {
      x: anchorPosition.x - anchorRelative.x,
      y: anchorPosition.y - anchorRelative.y,
    };
  }

  for (const slot of input.slots) {
    const slotPosition = slotProjectionPlacement({
      layout: input.layout,
      slot,
      task: input.task,
    })?.position;
    const slotRelative = input.relative.get(slot.id);
    if (slotPosition !== undefined && slotRelative !== undefined) {
      return {
        x: slotPosition.x - slotRelative.x,
        y: slotPosition.y - slotRelative.y,
      };
    }
  }

  if (unknownSlotPosition !== undefined && anchorRelative !== undefined) {
    return {
      x: unknownSlotPosition.x - anchorRelative.x,
      y: unknownSlotPosition.y - anchorRelative.y,
    };
  }

  return { x: 0, y: 0 };
}

export function shouldShowDeploymentPlaceholder(
  task: DeploymentTaskProjection,
  now = new Date()
): boolean {
  const projectId = task.projectId?.trim();
  if (!projectId) {
    return false;
  }
  return deploymentTaskProjectionIsVisible(task, now);
}

function unknownSlotPlaceholderNode(
  task: DeploymentTaskProjection,
  index: number,
  layout?: CanvasLayoutDocument
): CanvasDeploymentPlaceholderRfNode {
  const placement = unknownSlotProjectionPlacement({ layout, task });
  return {
    data: {
      groupId: task.id,
      hasProjectionPlacement: placement !== undefined,
      ...(placement?.source === undefined
        ? {}
        : { projectionPlacementSource: placement.source }),
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: task.id,
    },
    id: deploymentPlaceholderNodeId(task.id),
    position: placement?.position ?? {
      x: index * COLUMN_STEP,
      y: 0,
    },
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

function resultPreviewPlaceholderNodes(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  task: DeploymentTaskProjection;
  preview: DeploymentResultPreview;
}): CanvasDeploymentPlaceholderRfNode[] {
  const { positions, relative, saved } = materializedSlotPositions({
    layout: input.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  const anchor = anchorSlot(input.preview.slots);
  const unknownSlotPlacement = unknownSlotProjectionPlacement({
    layout: input.layout,
    task: input.task,
  });
  return input.preview.slots.flatMap((slot) => {
    const placement = slotProjectionPlacement({
      layout: input.layout,
      slot,
      task: input.task,
    });
    const expectedResultRef = resultRefForSlot({ slot, task: input.task });
    if (
      expectedResultRef !== undefined &&
      (resultRefHasSavedLayout(expectedResultRef, input.layout) ||
        resultRefHasLiveNode(expectedResultRef, input.nodes ?? []))
    ) {
      return [];
    }
    const position = positions.get(slot.id) ?? { x: 0, y: 0 };
    const projectionPlacementSource =
      placement?.source ??
      (slot.id === anchor?.id ? unknownSlotPlacement?.source : undefined);
    const data: CanvasDeploymentPlaceholderNodeData = {
      ...(slot.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      anchor: slot.anchor === true || anchor?.id === slot.id,
      groupId: input.task.id,
      hasProjectionPlacement: saved.has(slot.id),
      projectionEdges: input.preview.edges,
      ...(projectionPlacementSource === undefined
        ? {}
        : { projectionPlacementSource }),
      projectionRelativePlacement: relative.get(slot.id) ?? { x: 0, y: 0 },
      projectionSlots: input.preview.slots.map((item) => {
        const itemPlacement = slotProjectionPlacement({
          layout: input.layout,
          slot: item,
          task: input.task,
        });
        return {
          ...(item.expectedRef === undefined
            ? {}
            : { expectedRef: item.expectedRef }),
          id: item.id,
          ...(itemPlacement === undefined
            ? {}
            : {
                position: {
                  ...(itemPlacement.source === undefined
                    ? {}
                    : { source: itemPlacement.source }),
                  x: itemPlacement.position.x,
                  y: itemPlacement.position.y,
                },
              }),
          ...(item.anchor === undefined ? {} : { anchor: item.anchor }),
        };
      }),
      slotId: slot.id,
      taskId: input.task.id,
    };
    return [
      {
        data,
        id: projectionSlotNodeId(input.task.id, slot.id),
        position,
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ];
  });
}

export function deploymentPlaceholderNodesFromTasks(
  tasks: readonly DeploymentTaskProjection[] | undefined,
  options?: {
    layout?: CanvasLayoutDocument;
    nodes?: readonly Node[];
    now?: Date;
  }
): CanvasDeploymentPlaceholderRfNode[] {
  if (tasks == null) {
    return [];
  }
  return tasks.flatMap((task, index) => {
    if (!shouldShowDeploymentPlaceholder(task, options?.now)) {
      return [];
    }
    const preview = deploymentResultPreview(task);
    if (preview !== undefined) {
      return resultPreviewPlaceholderNodes({
        layout: options?.layout,
        nodes: options?.nodes,
        preview,
        task,
      });
    }
    return [unknownSlotPlaceholderNode(task, index, options?.layout)];
  });
}

export function deploymentPlaceholderHandoffs(input: {
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  tasks?: readonly DeploymentTaskProjection[];
}): {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
} {
  const byNodeId = new Map<string, CanvasLayoutPosition>();
  const byRef = new Map<string, CanvasLayoutPosition>();
  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview !== undefined) {
      addPreviewHandoffs({
        byNodeId,
        byRef,
        layout: input.layout,
        nodes: input.nodes,
        preview,
        task,
      });
    }
  }
  return { byNodeId, byRef };
}

function addResultRefHandoff(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  position: CanvasLayoutPosition;
  ref: DeploymentTaskResultResourceRef;
}): void {
  if (input.ref.kind === "TemplateNative") {
    const node = nodesByTemplateKey(input.nodes).get(
      `${input.ref.namespace}/${input.ref.name}`
    );
    if (node !== undefined) {
      input.byNodeId.set(node.id, input.position);
    }
    return;
  }
  if (layoutHasRef(input.layout, input.ref)) {
    return;
  }
  if (nodesByRef(input.nodes).has(canvasResourceKey(input.ref))) {
    input.byRef.set(canvasResourceKey(input.ref), input.position);
  }
}

function addPreviewHandoffs(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}): void {
  const materialized = materializedSlotPositions({
    layout: input.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  const unknownSlotPlacement = unknownSlotProjectionPlacement({
    layout: input.layout,
    task: input.task,
  });
  for (const slot of input.preview.slots) {
    const slotPlacement = slotProjectionPlacement({
      layout: input.layout,
      slot,
      task: input.task,
    });
    const position =
      slotPlacement?.position ??
      (unknownSlotPlacement === undefined
        ? undefined
        : materialized.positions.get(slot.id));
    const expectedRef = resultRefForSlot({ slot, task: input.task });
    if (position === undefined || expectedRef === undefined) {
      continue;
    }
    addResultRefHandoff({
      byNodeId: input.byNodeId,
      byRef: input.byRef,
      layout: input.layout,
      nodes: input.nodes,
      position,
      ref: expectedRef,
    });
  }
}

export function deploymentPlaceholderPendingResultKeys(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  tasks?: readonly DeploymentTaskProjection[];
}): {
  refs: Set<string>;
  templates: Set<string>;
} {
  const refs = new Set<string>();
  const templates = new Set<string>();
  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview === undefined) {
      continue;
    }
    addPreviewPendingResultKeys({
      layout: input.layout,
      nodes: input.nodes,
      preview,
      refs,
      task,
      templates,
    });
  }
  return { refs, templates };
}

function addPendingResultKey(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  ref: DeploymentTaskResultResourceRef;
  refs: Set<string>;
  templates: Set<string>;
}): void {
  if (resultRefHasLiveNode(input.ref, input.nodes ?? [])) {
    return;
  }
  if (input.ref.kind === "TemplateNative") {
    input.templates.add(`${input.ref.namespace}/${input.ref.name}`);
    return;
  }
  if (!layoutHasRef(input.layout, input.ref)) {
    input.refs.add(canvasResourceKey(input.ref));
  }
}

function addPreviewPendingResultKeys(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  preview: DeploymentResultPreview;
  refs: Set<string>;
  task: DeploymentTaskProjection;
  templates: Set<string>;
}): void {
  for (const slot of input.preview.slots) {
    const expectedRef = resultRefForSlot({ slot, task: input.task });
    if (
      expectedRef === undefined ||
      slotProjectionPlacement({
        layout: input.layout,
        slot,
        task: input.task,
      }) !== undefined
    ) {
      continue;
    }
    addPendingResultKey({
      layout: input.layout,
      nodes: input.nodes,
      ref: expectedRef,
      refs: input.refs,
      templates: input.templates,
    });
  }
}

export function isDeploymentPlaceholderPendingResultNode(input: {
  keys: ReturnType<typeof deploymentPlaceholderPendingResultKeys>;
  node: Node;
}): boolean {
  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined && input.keys.refs.has(canvasResourceKey(ref))) {
    return true;
  }
  const templateKey = templateNodeKeyFromNode(input.node);
  return templateKey !== undefined && input.keys.templates.has(templateKey);
}

export function shouldHideDeploymentPlaceholderForHandoff(input: {
  layout?: CanvasLayoutDocument;
  node: CanvasDeploymentPlaceholderRfNode;
  nodes: readonly Node[];
}): boolean {
  if (hasProjectionSlotGroup(input.node.data)) {
    const expectedRef = expectedRefToResultRef(input.node.data.expectedRef);
    return (
      expectedRef !== undefined &&
      (resultRefHasSavedLayout(expectedRef, input.layout) ||
        (input.node.data.hasProjectionPlacement === true &&
          resultRefHasLiveNode(expectedRef, input.nodes)))
    );
  }

  return false;
}

function nodeIdForSlot(input: {
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
  slot: DeploymentTaskCanvasProjectionSlot | undefined;
  taskId: string;
}): string | undefined {
  if (input.slot === undefined) {
    return undefined;
  }
  const expectedRef = input.slot.expectedRef;
  if (expectedRef !== undefined) {
    const liveNode = input.liveNodeByExpectedRef.get(
      expectedRefKey(expectedRef)
    );
    if (liveNode !== undefined) {
      return liveNode.id;
    }
  }
  return input.placeholderByTaskSlotId.get(
    deploymentSlotOwnerKey(input.taskId, input.slot.id)
  )?.id;
}

function deploymentPreviewNodeIndexes(nodes: readonly Node[]): {
  liveNodeByExpectedRef: Map<string, Node>;
  placeholderByTaskSlotId: Map<string, Node>;
} {
  const liveNodeByExpectedRef = new Map<string, Node>();
  const placeholderByTaskSlotId = new Map<string, Node>();
  for (const node of nodes) {
    addDeploymentPreviewNodeToIndexes({
      liveNodeByExpectedRef,
      node,
      placeholderByTaskSlotId,
    });
  }
  return { liveNodeByExpectedRef, placeholderByTaskSlotId };
}

function addDeploymentPreviewNodeToIndexes(input: {
  liveNodeByExpectedRef: Map<string, Node>;
  node: Node;
  placeholderByTaskSlotId: Map<string, Node>;
}): void {
  if (isDeploymentPlaceholderNode(input.node)) {
    addDeploymentPlaceholderNodeToIndexes(input);
    return;
  }
  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined) {
    input.liveNodeByExpectedRef.set(expectedRefKey(ref), input.node);
    return;
  }
  const templateKey = templateNodeKeyFromNode(input.node);
  if (templateKey !== undefined) {
    const [namespace, name] = templateKey.split("/");
    if (namespace !== undefined && name !== undefined) {
      input.liveNodeByExpectedRef.set(
        expectedRefKey({ kind: "TemplateNative", name, namespace }),
        input.node
      );
    }
  }
}

function addDeploymentPlaceholderNodeToIndexes(input: {
  node: Node;
  placeholderByTaskSlotId: Map<string, Node>;
}): void {
  if (!isDeploymentPlaceholderNode(input.node)) {
    return;
  }
  if (input.node.data.slotId === undefined) {
    return;
  }
  input.placeholderByTaskSlotId.set(
    deploymentSlotOwnerKey(input.node.data.taskId, input.node.data.slotId),
    input.node
  );
}

function deploymentPreviewEdgeForTask(input: {
  edge: DeploymentTaskCanvasProjectionEdge;
  existingPairs: ReadonlySet<string>;
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
  slotsById: ReadonlyMap<string, DeploymentTaskCanvasProjectionSlot>;
  taskId: string;
}): Edge | undefined {
  const source = nodeIdForSlot({
    liveNodeByExpectedRef: input.liveNodeByExpectedRef,
    placeholderByTaskSlotId: input.placeholderByTaskSlotId,
    slot: input.slotsById.get(input.edge.sourceSlotId),
    taskId: input.taskId,
  });
  const target = nodeIdForSlot({
    liveNodeByExpectedRef: input.liveNodeByExpectedRef,
    placeholderByTaskSlotId: input.placeholderByTaskSlotId,
    slot: input.slotsById.get(input.edge.targetSlotId),
    taskId: input.taskId,
  });
  if (
    source === undefined ||
    target === undefined ||
    input.existingPairs.has(`${source}->${target}`)
  ) {
    return undefined;
  }
  return {
    animated: true,
    data: { evidence: input.edge.evidence, kind: "deploymentPreview" },
    id: `deployment-preview-${sanitizeNodeIdPart(input.taskId)}-${sanitizeNodeIdPart(input.edge.id ?? `${input.edge.sourceSlotId}-${input.edge.targetSlotId}`)}`,
    source,
    style: {
      opacity: 0.62,
      stroke: "var(--color-blue-300)",
      strokeDasharray: "4 8",
    },
    target,
  };
}

function deploymentPreviewEdgesForTask(input: {
  existingPairs: ReadonlySet<string>;
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
  preview: DeploymentResultPreview;
  taskId: string;
}): Edge[] {
  const slotsById = new Map(input.preview.slots.map((slot) => [slot.id, slot]));
  return input.preview.edges.flatMap((edge) => {
    const previewEdge = deploymentPreviewEdgeForTask({
      edge,
      existingPairs: input.existingPairs,
      liveNodeByExpectedRef: input.liveNodeByExpectedRef,
      placeholderByTaskSlotId: input.placeholderByTaskSlotId,
      slotsById,
      taskId: input.taskId,
    });
    return previewEdge === undefined ? [] : [previewEdge];
  });
}

export function deploymentPreviewEdgesFromTasks(input: {
  existingEdges?: readonly Edge[];
  nodes: readonly Node[];
  tasks?: readonly DeploymentTaskProjection[];
}): Edge[] {
  const { liveNodeByExpectedRef, placeholderByTaskSlotId } =
    deploymentPreviewNodeIndexes(input.nodes);
  const existingPairs = new Set(
    (input.existingEdges ?? []).map((edge) => `${edge.source}->${edge.target}`)
  );
  const edges: Edge[] = [];
  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview === undefined) {
      continue;
    }
    edges.push(
      ...deploymentPreviewEdgesForTask({
        existingPairs,
        liveNodeByExpectedRef,
        placeholderByTaskSlotId,
        preview,
        taskId: task.id,
      })
    );
  }
  return edges;
}

function projectionPlacementNode(input: {
  position: CanvasLayoutPosition;
  slotId: string;
  source: CanvasPlacementSource;
  taskId: string;
}): CanvasLayoutNode {
  return canvasLayoutNodeFromOwner({
    owner: deploymentProjectionPlacementOwner({
      slotId: input.slotId,
      taskId: input.taskId,
    }),
    position: input.position,
    source: input.source,
  });
}

function projectionSlotPlacementSource(input: {
  anchorSource: CanvasDeploymentPlaceholderNodeData["projectionPlacementSource"];
  anchorSlotId: string | undefined;
  saveSource: CanvasPlacementSource;
  slot: NonNullable<
    CanvasDeploymentPlaceholderNodeData["projectionSlots"]
  >[number];
}): CanvasPlacementSource {
  if (input.saveSource === "user") {
    return "user";
  }
  return input.anchorSource === "user" && input.slot.id === input.anchorSlotId
    ? "user"
    : "generated";
}

export function deploymentProjectionPlacementNodesFromPlaceholderNode(input: {
  node: Node;
  nodes: readonly Node[];
  source: CanvasPlacementSource;
}): CanvasLayoutNode[] {
  if (!isDeploymentPlaceholderNode(input.node)) {
    return [];
  }
  const placeholderNode = input.node;
  if (!hasProjectionSlotGroup(placeholderNode.data)) {
    return [
      projectionPlacementNode({
        position: placeholderNode.position,
        slotId: placeholderNode.data.slotId ?? DEPLOYMENT_UNKNOWN_SLOT_ID,
        source: input.source,
        taskId: placeholderNode.data.taskId,
      }),
    ];
  }

  const groupNodes = input.nodes.filter(
    (node): node is CanvasDeploymentPlaceholderRfNode =>
      isDeploymentPlaceholderNode(node) &&
      node.data.taskId === placeholderNode.data.taskId &&
      hasProjectionSlotGroup(node.data)
  );
  const previous = groupNodes.find((node) => node.id === placeholderNode.id);
  const delta =
    previous === undefined
      ? { x: 0, y: 0 }
      : {
          x: placeholderNode.position.x - previous.position.x,
          y: placeholderNode.position.y - previous.position.y,
        };
  const anchorSlotId =
    placeholderNode.data.projectionSlots.find((slot) => slot.anchor === true)
      ?.id ??
    (placeholderNode.data.anchor === true
      ? placeholderNode.data.slotId
      : undefined);
  return placeholderNode.data.projectionSlots.map((slot) => {
    const node =
      groupNodes.find((candidate) => candidate.data.slotId === slot.id) ??
      (placeholderNode.data.slotId === slot.id ? placeholderNode : undefined);
    const position = node?.position ?? slot.position ?? { x: 0, y: 0 };
    return projectionPlacementNode({
      position: {
        x: position.x + (input.source === "user" ? delta.x : 0),
        y: position.y + (input.source === "user" ? delta.y : 0),
      },
      slotId: slot.id,
      source: projectionSlotPlacementSource({
        anchorSource: placeholderNode.data.projectionPlacementSource,
        anchorSlotId,
        saveSource: input.source,
        slot,
      }),
      taskId: placeholderNode.data.taskId,
    });
  });
}

function hasLayoutOwner(
  layout: CanvasLayoutDocument | undefined,
  ownerKey: string
): boolean {
  return layoutNodeByOwner(layout).has(ownerKey);
}

function projectionSlotPlacementOwner(slot: {
  id: string;
  taskId: string;
}): ReturnType<typeof deploymentProjectionPlacementOwner> {
  return deploymentProjectionPlacementOwner({
    slotId: slot.id,
    taskId: slot.taskId,
  });
}

function addCommandOnce(
  commands: PlacementCommand[],
  seen: Set<string>,
  command: PlacementCommand
): void {
  const key =
    command.kind === "rekey"
      ? `${command.kind}:${canvasPlacementOwnerKey(command.fromOwner)}:${canvasPlacementOwnerKey(command.toOwner)}`
      : `${command.kind}:${canvasPlacementOwnerKey(command.owner)}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  commands.push(command);
}

function projectionSlotIsVisible(
  task: DeploymentTaskProjection,
  now: Date
): boolean {
  return shouldShowDeploymentPlaceholder(task, now);
}

function addUnknownSlotRefinementCommands(input: {
  commands: PlacementCommand[];
  layout?: CanvasLayoutDocument;
  preview: DeploymentResultPreview;
  seen: Set<string>;
  task: DeploymentTaskProjection;
}): void {
  const anchor = anchorSlot(input.preview.slots);
  if (anchor === undefined) {
    return;
  }
  const fromOwner = deploymentProjectionPlacementOwner({
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
  const fromKey = canvasPlacementOwnerKey(fromOwner);
  if (!hasLayoutOwner(input.layout, fromKey)) {
    return;
  }
  const toOwner = projectionSlotPlacementOwner({
    id: anchor.id,
    taskId: input.task.id,
  });
  addCommandOnce(input.commands, input.seen, {
    fromOwner,
    kind: "rekey",
    toOwner,
  });
}

function addSlotHandoffOrExpiryCommand(input: {
  commands: PlacementCommand[];
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  seen: Set<string>;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
  now: Date;
}): void {
  const slotOwner = projectionSlotPlacementOwner({
    id: input.slot.id,
    taskId: input.task.id,
  });
  const slotOwnerKey = canvasPlacementOwnerKey(slotOwner);
  if (!hasLayoutOwner(input.layout, slotOwnerKey)) {
    return;
  }

  const expectedRef = layoutRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  const expectedResultRef = resultRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  if (
    expectedRef !== undefined &&
    expectedResultRef !== undefined &&
    resultRefHasLiveNode(expectedResultRef, input.nodes)
  ) {
    const resourceOwner = resourcePlacementOwner(expectedRef);
    if (hasLayoutOwner(input.layout, resourceOwnerKey(expectedRef))) {
      addCommandOnce(input.commands, input.seen, {
        kind: "delete",
        owner: slotOwner,
      });
      return;
    }
    addCommandOnce(input.commands, input.seen, {
      fromOwner: slotOwner,
      kind: "rekey",
      toOwner: resourceOwner,
    });
    return;
  }

  if (!projectionSlotIsVisible(input.task, input.now)) {
    addCommandOnce(input.commands, input.seen, {
      kind: "delete",
      owner: slotOwner,
    });
  }
}

function addUnknownSlotExpiryCommand(input: {
  commands: PlacementCommand[];
  layout?: CanvasLayoutDocument;
  seen: Set<string>;
  task: DeploymentTaskProjection;
  now: Date;
}): void {
  if (projectionSlotIsVisible(input.task, input.now)) {
    return;
  }
  const owner = deploymentProjectionPlacementOwner({
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
  if (!hasLayoutOwner(input.layout, canvasPlacementOwnerKey(owner))) {
    return;
  }
  addCommandOnce(input.commands, input.seen, {
    kind: "delete",
    owner,
  });
}

export function deploymentProjectionPlacementCommands(input: {
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  now?: Date;
  tasks?: readonly DeploymentTaskProjection[];
}): PlacementCommand[] {
  const commands: PlacementCommand[] = [];
  const seen = new Set<string>();
  const now = input.now ?? new Date();

  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview === undefined) {
      addUnknownSlotExpiryCommand({
        commands,
        layout: input.layout,
        now,
        seen,
        task,
      });
      continue;
    }

    addUnknownSlotRefinementCommands({
      commands,
      layout: input.layout,
      preview,
      seen,
      task,
    });
    for (const slot of preview.slots) {
      addSlotHandoffOrExpiryCommand({
        commands,
        layout: input.layout,
        nodes: input.nodes,
        now,
        seen,
        slot,
        task,
      });
    }
  }

  return commands;
}
