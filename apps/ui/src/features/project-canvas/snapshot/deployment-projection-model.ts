import type { Node } from "@xyflow/react";
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
} from "../layout/types";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";

export const DEPLOYMENT_PLACEHOLDER_COMPLETED_GRACE_MS =
  DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS;

export interface DeploymentTaskTemplateNativeResultRef {
  kind: "TemplateNative";
  name: string;
  namespace: string;
}

export type DeploymentTaskResultResourceRef =
  | CanvasLayoutResourceRef
  | DeploymentTaskTemplateNativeResultRef;

export interface DeploymentResultPreview {
  edges: DeploymentTaskCanvasProjectionEdge[];
  slots: DeploymentTaskCanvasProjectionSlot[];
}

export interface DeploymentTaskResultPreview {
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}

export interface DeploymentProjectionPlacement {
  persisted: boolean;
  position: CanvasLayoutPosition;
  source?: CanvasPlacementSource;
}

export function sanitizeNodeIdPart(value: string): string {
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

export function layoutNodeByOwner(
  layout: CanvasLayoutDocument | undefined
): Map<string, CanvasLayoutNode> {
  return new Map(
    (layout?.nodes ?? []).map((node) => [canvasLayoutNodeKey(node), node])
  );
}

export function deploymentSlotOwnerKey(taskId: string, slotId: string): string {
  return canvasPlacementOwnerKey(
    deploymentProjectionPlacementOwner({ slotId, taskId })
  );
}

export function resourceOwnerKey(ref: CanvasLayoutResourceRef): string {
  return canvasPlacementOwnerKey(resourcePlacementOwner(ref));
}

export function deploymentProjectionPlacement(input: {
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

export function unknownSlotProjectionPlacement(input: {
  layout?: CanvasLayoutDocument;
  task: DeploymentTaskProjection;
}): DeploymentProjectionPlacement | undefined {
  return deploymentProjectionPlacement({
    layout: input.layout,
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
}

export function slotProjectionPlacement(input: {
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

export function expectedRefKey(
  ref: DeploymentTaskCanvasProjectionExpectedRef
): string {
  return `${ref.kind}:${ref.namespace}:${ref.name}`;
}

export function expectedRefToLayoutRef(
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

export function expectedRefToResultRef(
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

export function resultRefForSlot(input: {
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

export function layoutRefForSlot(input: {
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

export function layoutHasRef(
  layout: CanvasLayoutDocument | undefined,
  ref: CanvasLayoutResourceRef
): boolean {
  const key = canvasResourceKey(ref);
  return (layout?.nodes ?? []).some((node) => {
    const resourceRef = canvasLayoutNodeResourceRef(node);
    return resourceRef !== undefined && canvasResourceKey(resourceRef) === key;
  });
}

export function templateNodeKeyFromNode(node: Node): string | undefined {
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

export function nodesByRef(nodes: readonly Node[]): Map<string, Node> {
  return new Map(
    nodes.flatMap((node) => {
      const ref = canvasResourceIdentityFromNode(node);
      return ref === undefined ? [] : [[canvasResourceKey(ref), node] as const];
    })
  );
}

export function nodesByTemplateKey(nodes: readonly Node[]): Map<string, Node> {
  return new Map(
    nodes.flatMap((node) => {
      const key = templateNodeKeyFromNode(node);
      return key === undefined ? [] : [[key, node] as const];
    })
  );
}

export function nodeForResultRef(
  ref: DeploymentTaskResultResourceRef,
  nodes: readonly Node[]
): Node | undefined {
  if (ref.kind === "TemplateNative") {
    return nodesByTemplateKey(nodes).get(`${ref.namespace}/${ref.name}`);
  }
  return nodesByRef(nodes).get(canvasResourceKey(ref));
}

export function resultRefHasLiveNode(
  ref: DeploymentTaskResultResourceRef,
  nodes: readonly Node[]
): boolean {
  return nodeForResultRef(ref, nodes) !== undefined;
}

export function resultRefHasSavedLayout(
  ref: DeploymentTaskResultResourceRef,
  layout: CanvasLayoutDocument | undefined
): boolean {
  return ref.kind !== "TemplateNative" && layoutHasRef(layout, ref);
}

function resourceLayoutPosition(input: {
  layout?: CanvasLayoutDocument;
  ref: CanvasLayoutResourceRef;
}): CanvasLayoutPosition | undefined {
  const node = layoutNodeByOwner(input.layout).get(resourceOwnerKey(input.ref));
  return node === undefined
    ? undefined
    : { x: node.position.x, y: node.position.y };
}

function savedResourcePositionForSlot(input: {
  layout?: CanvasLayoutDocument;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
}): CanvasLayoutPosition | undefined {
  const ref = layoutRefForSlot(input);
  return ref === undefined
    ? undefined
    : resourceLayoutPosition({ layout: input.layout, ref });
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

export function deploymentResultPreview(
  task: DeploymentTaskProjection
): DeploymentResultPreview | undefined {
  return explicitPreview(task) ?? derivedPreview(task);
}

export function deploymentResultPreviewsFromTasks(
  tasks: readonly DeploymentTaskProjection[] | undefined
): DeploymentTaskResultPreview[] {
  return (tasks ?? []).flatMap((task) => {
    const preview = deploymentResultPreview(task);
    return preview === undefined ? [] : [{ preview, task }];
  });
}

export function deploymentResultPreviewByTaskId(
  previews: readonly DeploymentTaskResultPreview[] | undefined
): Map<string, DeploymentResultPreview> {
  return new Map(
    (previews ?? []).map(({ preview, task }) => [task.id, preview])
  );
}

export function anchorSlot(
  slots: readonly DeploymentTaskCanvasProjectionSlot[]
) {
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

export function materializedSlotPositions(input: {
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
  const anchorResourcePosition =
    anchor === undefined
      ? undefined
      : savedResourcePositionForSlot({
          layout: input.layout,
          slot: anchor,
          task: input.task,
        });
  const anchorPosition =
    anchor === undefined
      ? undefined
      : slotProjectionPlacement({
          layout: input.layout,
          slot: anchor,
          task: input.task,
        })?.position;
  if (anchorResourcePosition !== undefined && anchorRelative !== undefined) {
    return {
      x: anchorResourcePosition.x - anchorRelative.x,
      y: anchorResourcePosition.y - anchorRelative.y,
    };
  }
  if (anchorPosition !== undefined && anchorRelative !== undefined) {
    return {
      x: anchorPosition.x - anchorRelative.x,
      y: anchorPosition.y - anchorRelative.y,
    };
  }

  for (const slot of input.slots) {
    const resourcePosition = savedResourcePositionForSlot({
      layout: input.layout,
      slot,
      task: input.task,
    });
    const slotRelative = input.relative.get(slot.id);
    if (resourcePosition !== undefined && slotRelative !== undefined) {
      return {
        x: resourcePosition.x - slotRelative.x,
        y: resourcePosition.y - slotRelative.y,
      };
    }
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
