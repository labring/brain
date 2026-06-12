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
  DeploymentTaskCanvasProjection,
  DeploymentTaskCanvasProjectionEdge,
  DeploymentTaskCanvasProjectionExpectedRef,
  DeploymentTaskCanvasProjectionPositionSource,
  DeploymentTaskCanvasProjectionSlot,
} from "@/lib/deploy-task/types";
import {
  COLUMN_STEP,
  PUBLIC_ACCESS_AP_LEFT_OFFSET,
  ROW_STEP,
} from "../layout/placement-geometry";
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

type PlaceholderProjectionPatch =
  | { kind: "generic"; projection: DeploymentTaskCanvasProjection }
  | { kind: "result-preview"; projection: DeploymentTaskCanvasProjection };

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

function finitePosition(
  position: DeploymentTaskProjection["canvasProjection"]["position"]
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

function positionWithSource(
  position: CanvasLayoutPosition,
  source: DeploymentTaskCanvasProjectionPositionSource
): NonNullable<DeploymentTaskCanvasProjection["position"]> {
  return { source, x: position.x, y: position.y };
}

function projectionSlotPositionSource(input: {
  anchorSource: DeploymentTaskCanvasProjectionPositionSource | undefined;
  primarySlotId: string | undefined;
  saveSource: DeploymentTaskCanvasProjectionPositionSource;
  slot: NonNullable<
    CanvasDeploymentPlaceholderNodeData["projectionSlots"]
  >[number];
}): DeploymentTaskCanvasProjectionPositionSource {
  if (input.saveSource === "user") {
    return "user";
  }
  if (input.slot.position?.source !== undefined) {
    return input.slot.position.source;
  }
  return input.anchorSource === "user" && input.slot.id === input.primarySlotId
    ? "user"
    : "generated";
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

function primarySlot(slots: readonly DeploymentTaskCanvasProjectionSlot[]) {
  return (
    slots.find((slot) => slot.primary === true) ??
    slots.find((slot) => slot.expectedRef?.kind === "AP") ??
    slots.find((slot) => slot.expectedRef?.kind === "DB") ??
    slots[0]
  );
}

function relativeSlotPositions(
  slots: readonly DeploymentTaskCanvasProjectionSlot[]
): Map<string, CanvasLayoutPosition> {
  const primary = primarySlot(slots);
  const primaryId = primary?.id;
  const publicAccessForPrimary = slots.find(
    (slot) =>
      slot.expectedRef?.kind === "PublicAccess" &&
      primary?.expectedRef?.kind === "AP" &&
      slot.expectedRef.namespace === primary.expectedRef.namespace &&
      slot.expectedRef.name === primary.expectedRef.name
  );
  const primaryX =
    publicAccessForPrimary === undefined ? 0 : PUBLIC_ACCESS_AP_LEFT_OFFSET;
  const positions = new Map<string, CanvasLayoutPosition>();
  if (publicAccessForPrimary !== undefined) {
    positions.set(publicAccessForPrimary.id, { x: 0, y: 0 });
  }
  if (primaryId !== undefined) {
    positions.set(primaryId, { x: primaryX, y: 0 });
  }

  let column = publicAccessForPrimary === undefined ? 1 : 2;
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
  slots: readonly DeploymentTaskCanvasProjectionSlot[];
  task: DeploymentTaskProjection;
}): {
  positions: Map<string, CanvasLayoutPosition>;
  relative: Map<string, CanvasLayoutPosition>;
} {
  const relative = relativeSlotPositions(input.slots);
  const positions = new Map<string, CanvasLayoutPosition>();
  const origin = materializedSlotOrigin({
    relative,
    slots: input.slots,
    task: input.task,
  });
  for (const slot of input.slots) {
    const slotPosition = finitePosition(slot.position);
    if (slotPosition !== undefined) {
      positions.set(slot.id, slotPosition);
      continue;
    }
    const slotRelative = relative.get(slot.id) ?? { x: 0, y: 0 };
    positions.set(slot.id, {
      x: origin.x + slotRelative.x,
      y: origin.y + slotRelative.y,
    });
  }
  return { positions, relative };
}

function materializedSlotOrigin(input: {
  relative: ReadonlyMap<string, CanvasLayoutPosition>;
  slots: readonly DeploymentTaskCanvasProjectionSlot[];
  task: DeploymentTaskProjection;
}): CanvasLayoutPosition {
  const primary = primarySlot(input.slots);
  const genericPosition = finitePosition(input.task.canvasProjection.position);
  const primaryRelative =
    primary === undefined ? undefined : input.relative.get(primary.id);
  const primaryPosition =
    primary === undefined ? undefined : finitePosition(primary.position);
  if (primaryPosition !== undefined && primaryRelative !== undefined) {
    return {
      x: primaryPosition.x - primaryRelative.x,
      y: primaryPosition.y - primaryRelative.y,
    };
  }

  for (const slot of input.slots) {
    const slotPosition = finitePosition(slot.position);
    const slotRelative = input.relative.get(slot.id);
    if (slotPosition !== undefined && slotRelative !== undefined) {
      return {
        x: slotPosition.x - slotRelative.x,
        y: slotPosition.y - slotRelative.y,
      };
    }
  }

  if (genericPosition !== undefined && primaryRelative !== undefined) {
    return {
      x: genericPosition.x - primaryRelative.x,
      y: genericPosition.y - primaryRelative.y,
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

function genericDeploymentPlaceholderNode(
  task: DeploymentTaskProjection,
  index: number
): CanvasDeploymentPlaceholderRfNode {
  const projectionPosition = finitePosition(task.canvasProjection.position);
  return {
    data: {
      hasProjectionPosition: projectionPosition !== undefined,
      projectionShape: "generic",
      taskId: task.id,
    },
    id: deploymentPlaceholderNodeId(task.id),
    position: projectionPosition ?? {
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
  const { positions, relative } = materializedSlotPositions({
    slots: input.preview.slots,
    task: input.task,
  });
  return input.preview.slots.flatMap((slot) => {
    const projectedPosition = finitePosition(slot.position);
    const expectedResultRef = expectedRefToResultRef(slot.expectedRef);
    if (
      expectedResultRef !== undefined &&
      (resultRefHasSavedLayout(expectedResultRef, input.layout) ||
        (projectedPosition !== undefined &&
          resultRefHasLiveNode(expectedResultRef, input.nodes ?? [])))
    ) {
      return [];
    }
    const position = positions.get(slot.id) ?? { x: 0, y: 0 };
    const data: CanvasDeploymentPlaceholderNodeData = {
      ...(slot.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      groupId: input.task.id,
      hasProjectionPosition: projectedPosition !== undefined,
      primary:
        slot.primary === true ||
        primarySlot(input.preview.slots)?.id === slot.id,
      projectionEdges: input.preview.edges,
      ...(input.task.canvasProjection.position?.source === undefined
        ? {}
        : {
            projectionPositionSource:
              input.task.canvasProjection.position.source,
          }),
      projectionRelativePosition: relative.get(slot.id) ?? { x: 0, y: 0 },
      projectionShape: "result-preview",
      projectionSlots: input.preview.slots.map((item) => ({
        ...(item.expectedRef === undefined
          ? {}
          : { expectedRef: item.expectedRef }),
        id: item.id,
        ...(item.position === undefined
          ? {}
          : {
              position: {
                ...(item.position.source === undefined
                  ? {}
                  : { source: item.position.source }),
                x: item.position.x,
                y: item.position.y,
              },
            }),
        ...(item.primary === undefined ? {} : { primary: item.primary }),
      })),
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
    return [genericDeploymentPlaceholderNode(task, index)];
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
      });
      continue;
    }

    addGenericHandoff({
      byNodeId,
      byRef,
      layout: input.layout,
      nodes: input.nodes,
      task,
    });
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
}): void {
  for (const slot of input.preview.slots) {
    const position = finitePosition(slot.position);
    const expectedRef = expectedRefToResultRef(slot.expectedRef);
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

function addGenericHandoff(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  task: DeploymentTaskProjection;
}): void {
  const position = finitePosition(input.task.canvasProjection.position);
  const primary = primaryResultRef(taskResultResourceRefs(input.task));
  if (position === undefined || primary === undefined) {
    return;
  }
  addResultRefHandoff({
    byNodeId: input.byNodeId,
    byRef: input.byRef,
    layout: input.layout,
    nodes: input.nodes,
    position,
    ref: primary,
  });
}

export function deploymentPlaceholderPendingResultKeys(input: {
  layout?: CanvasLayoutDocument;
  tasks?: readonly DeploymentTaskProjection[];
}): {
  refs: Set<string>;
  templates: Set<string>;
} {
  const refs = new Set<string>();
  const templates = new Set<string>();
  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview !== undefined) {
      addPreviewPendingResultKeys({
        layout: input.layout,
        preview,
        refs,
        templates,
      });
      continue;
    }

    addGenericPendingResultKey({
      layout: input.layout,
      refs,
      task,
      templates,
    });
  }
  return { refs, templates };
}

function addPendingResultKey(input: {
  layout?: CanvasLayoutDocument;
  ref: DeploymentTaskResultResourceRef;
  refs: Set<string>;
  templates: Set<string>;
}): void {
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
  preview: DeploymentResultPreview;
  refs: Set<string>;
  templates: Set<string>;
}): void {
  for (const slot of input.preview.slots) {
    const expectedRef = expectedRefToResultRef(slot.expectedRef);
    if (
      expectedRef === undefined ||
      finitePosition(slot.position) !== undefined
    ) {
      continue;
    }
    addPendingResultKey({
      layout: input.layout,
      ref: expectedRef,
      refs: input.refs,
      templates: input.templates,
    });
  }
}

function addGenericPendingResultKey(input: {
  layout?: CanvasLayoutDocument;
  refs: Set<string>;
  task: DeploymentTaskProjection;
  templates: Set<string>;
}): void {
  if (finitePosition(input.task.canvasProjection.position) !== undefined) {
    return;
  }
  const primary = primaryResultRef(taskResultResourceRefs(input.task));
  if (primary === undefined) {
    return;
  }
  addPendingResultKey({
    layout: input.layout,
    ref: primary,
    refs: input.refs,
    templates: input.templates,
  });
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
  if (input.node.data.projectionShape === "result-preview") {
    const expectedRef = expectedRefToResultRef(input.node.data.expectedRef);
    return (
      expectedRef !== undefined &&
      (resultRefHasSavedLayout(expectedRef, input.layout) ||
        (input.node.data.hasProjectionPosition === true &&
          resultRefHasLiveNode(expectedRef, input.nodes)))
    );
  }

  return false;
}

function nodeIdForSlot(input: {
  nodeByExpectedRef: ReadonlyMap<string, Node>;
  nodeBySlotId: ReadonlyMap<string, Node>;
  slot: DeploymentTaskCanvasProjectionSlot | undefined;
}): string | undefined {
  if (input.slot === undefined) {
    return undefined;
  }
  const expectedRef = input.slot.expectedRef;
  if (expectedRef !== undefined) {
    const liveNode = input.nodeByExpectedRef.get(expectedRefKey(expectedRef));
    if (liveNode !== undefined) {
      return liveNode.id;
    }
  }
  return input.nodeBySlotId.get(input.slot.id)?.id;
}

function deploymentPreviewNodeIndexes(nodes: readonly Node[]): {
  nodeByExpectedRef: Map<string, Node>;
  nodeBySlotId: Map<string, Node>;
} {
  const nodeBySlotId = new Map<string, Node>();
  const nodeByExpectedRef = new Map<string, Node>();
  for (const node of nodes) {
    addDeploymentPreviewNodeToIndexes({
      node,
      nodeByExpectedRef,
      nodeBySlotId,
    });
  }
  return { nodeByExpectedRef, nodeBySlotId };
}

function addDeploymentPreviewNodeToIndexes(input: {
  node: Node;
  nodeByExpectedRef: Map<string, Node>;
  nodeBySlotId: Map<string, Node>;
}): void {
  if (isDeploymentPlaceholderNode(input.node)) {
    addDeploymentPlaceholderNodeToIndexes(input);
    return;
  }
  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined) {
    input.nodeByExpectedRef.set(expectedRefKey(ref), input.node);
    return;
  }
  const templateKey = templateNodeKeyFromNode(input.node);
  if (templateKey !== undefined) {
    const [namespace, name] = templateKey.split("/");
    if (namespace !== undefined && name !== undefined) {
      input.nodeByExpectedRef.set(
        expectedRefKey({ kind: "TemplateNative", name, namespace }),
        input.node
      );
    }
  }
}

function addDeploymentPlaceholderNodeToIndexes(input: {
  node: Node;
  nodeByExpectedRef: Map<string, Node>;
  nodeBySlotId: Map<string, Node>;
}): void {
  if (!isDeploymentPlaceholderNode(input.node)) {
    return;
  }
  if (input.node.data.slotId === undefined) {
    return;
  }
  input.nodeBySlotId.set(input.node.data.slotId, input.node);
  if (input.node.data.expectedRef !== undefined) {
    input.nodeByExpectedRef.set(
      expectedRefKey(input.node.data.expectedRef),
      input.node
    );
  }
}

function deploymentPreviewEdgeForTask(input: {
  edge: DeploymentTaskCanvasProjectionEdge;
  existingPairs: ReadonlySet<string>;
  nodeByExpectedRef: ReadonlyMap<string, Node>;
  nodeBySlotId: ReadonlyMap<string, Node>;
  slotsById: ReadonlyMap<string, DeploymentTaskCanvasProjectionSlot>;
  taskId: string;
}): Edge | undefined {
  const source = nodeIdForSlot({
    nodeByExpectedRef: input.nodeByExpectedRef,
    nodeBySlotId: input.nodeBySlotId,
    slot: input.slotsById.get(input.edge.sourceSlotId),
  });
  const target = nodeIdForSlot({
    nodeByExpectedRef: input.nodeByExpectedRef,
    nodeBySlotId: input.nodeBySlotId,
    slot: input.slotsById.get(input.edge.targetSlotId),
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
  nodeByExpectedRef: ReadonlyMap<string, Node>;
  nodeBySlotId: ReadonlyMap<string, Node>;
  preview: DeploymentResultPreview;
  taskId: string;
}): Edge[] {
  const slotsById = new Map(input.preview.slots.map((slot) => [slot.id, slot]));
  return input.preview.edges.flatMap((edge) => {
    const previewEdge = deploymentPreviewEdgeForTask({
      edge,
      existingPairs: input.existingPairs,
      nodeByExpectedRef: input.nodeByExpectedRef,
      nodeBySlotId: input.nodeBySlotId,
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
  const { nodeByExpectedRef, nodeBySlotId } = deploymentPreviewNodeIndexes(
    input.nodes
  );
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
        nodeByExpectedRef,
        nodeBySlotId,
        preview,
        taskId: task.id,
      })
    );
  }
  return edges;
}

export function deploymentProjectionPatchFromPlaceholderNode(input: {
  node: Node;
  nodes: readonly Node[];
  source: "generated" | "user";
}): PlaceholderProjectionPatch | null {
  if (!isDeploymentPlaceholderNode(input.node)) {
    return null;
  }
  if (input.node.data.projectionShape !== "result-preview") {
    return {
      kind: "generic",
      projection: {
        position: positionWithSource(input.node.position, input.source),
        shape: "generic",
      },
    };
  }

  const groupNodes = input.nodes.filter(
    (node): node is CanvasDeploymentPlaceholderRfNode =>
      isDeploymentPlaceholderNode(node) &&
      node.data.taskId === input.node.data.taskId &&
      node.data.projectionShape === "result-preview"
  );
  const previous = groupNodes.find((node) => node.id === input.node.id);
  const delta =
    previous === undefined
      ? { x: 0, y: 0 }
      : {
          x: input.node.position.x - previous.position.x,
          y: input.node.position.y - previous.position.y,
        };
  const primarySlotId =
    input.node.data.projectionSlots?.find((slot) => slot.primary === true)
      ?.id ??
    (input.node.data.primary === true ? input.node.data.slotId : undefined);
  const slots = (input.node.data.projectionSlots ?? []).map((slot) => {
    const node =
      groupNodes.find((candidate) => candidate.data.slotId === slot.id) ??
      (input.node.data.slotId === slot.id
        ? (input.node as CanvasDeploymentPlaceholderRfNode)
        : undefined);
    const position = node?.position ?? slot.position ?? { x: 0, y: 0 };
    return {
      ...(slot.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      id: slot.id,
      position: positionWithSource(
        {
          x: position.x + (input.source === "user" ? delta.x : 0),
          y: position.y + (input.source === "user" ? delta.y : 0),
        },
        projectionSlotPositionSource({
          anchorSource: input.node.data.projectionPositionSource,
          primarySlotId,
          saveSource: input.source,
          slot,
        })
      ),
      ...(slot.primary === undefined ? {} : { primary: slot.primary }),
    };
  });
  return {
    kind: "result-preview",
    projection: {
      edges: input.node.data.projectionEdges ?? [],
      shape: "result-preview",
      slots,
    },
  };
}
