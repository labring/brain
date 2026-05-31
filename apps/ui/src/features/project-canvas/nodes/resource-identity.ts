import type { Node } from "@xyflow/react";

import type {
  CanvasLayoutResourceKind,
  CanvasLayoutResourceRef,
} from "../layout/types";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "./constants";

const AP_BOUND_SURFACE_PREFIX = "entry";

export type CanvasResourceIdentity = CanvasLayoutResourceRef;

export interface ApBoundSurfaceKeyRef {
  apName: string;
  namespace: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function canvasResourceKey(ref: CanvasResourceIdentity): string {
  return `${ref.kind}:${ref.namespace}:${ref.name}`;
}

function resourceIdentityFromRecord(
  kind: CanvasLayoutResourceKind,
  source: Record<string, unknown> | undefined
): CanvasResourceIdentity | undefined {
  const name = nonEmptyString(source?.name);
  const namespace = nonEmptyString(source?.namespace);

  if (name === undefined || namespace === undefined) {
    return undefined;
  }

  return { kind, name, namespace };
}

function entryPointResourceIdentityFromRecord(
  source: Record<string, unknown> | undefined
): CanvasResourceIdentity | undefined {
  const namespace = nonEmptyString(source?.namespace);
  const apName = nonEmptyString(source?.apRef) ?? nonEmptyString(source?.name);

  if (apName === undefined || namespace === undefined) {
    return undefined;
  }

  return { kind: "EntryPoint", name: apName, namespace };
}

export function canvasResourceIdentityFromNode(
  node: Node
): CanvasResourceIdentity | undefined {
  const data = asRecord(node.data);

  switch (node.type) {
    case CANVAS_CONTAINER_NODE_TYPE:
      return resourceIdentityFromRecord("AP", asRecord(data?.states));
    case CANVAS_DATABASE_NODE_TYPE:
      return resourceIdentityFromRecord("DB", asRecord(data?.workload));
    case CANVAS_ENTRY_NODE_TYPE:
      return entryPointResourceIdentityFromRecord(asRecord(data?.resource));
    default:
      return undefined;
  }
}

export function canvasEntryPointApResourceIdentityFromNode(
  node: Node
): CanvasResourceIdentity | undefined {
  if (node.type !== CANVAS_ENTRY_NODE_TYPE) {
    return undefined;
  }

  const entryIdentity = canvasResourceIdentityFromNode(node);
  if (entryIdentity === undefined) {
    return undefined;
  }

  return {
    kind: "AP",
    name: entryIdentity.name,
    namespace: entryIdentity.namespace,
  };
}

export function canvasResourceLastSeenUidFromNode(
  node: Node
): string | undefined {
  const data = asRecord(node.data);

  switch (node.type) {
    case CANVAS_CONTAINER_NODE_TYPE:
      return nonEmptyString(asRecord(data?.states)?.uid);
    case CANVAS_DATABASE_NODE_TYPE:
      return nonEmptyString(data?.uid);
    case CANVAS_ENTRY_NODE_TYPE:
      return nonEmptyString(asRecord(data?.resource)?.uid);
    default:
      return undefined;
  }
}

export function apBoundSurfaceKey({
  apName,
  namespace,
}: ApBoundSurfaceKeyRef): string {
  return [
    AP_BOUND_SURFACE_PREFIX,
    encodeURIComponent(namespace),
    encodeURIComponent(apName),
  ].join(":");
}

export function apBoundSurfaceRefFromKey(
  key: string | null | undefined
): ApBoundSurfaceKeyRef | null {
  const parts = key?.split(":");
  if (parts?.length !== 3 || parts[0] !== AP_BOUND_SURFACE_PREFIX) {
    return null;
  }

  let namespace = "";
  let apName = "";
  try {
    namespace = decodeURIComponent(parts[1] ?? "").trim();
    apName = decodeURIComponent(parts[2] ?? "").trim();
  } catch {
    return null;
  }

  if (namespace === "" || apName === "") {
    return null;
  }

  return { apName, namespace };
}

export function canvasNodeSelectionKey(node: Node): string | null {
  const data = asRecord(node.data);

  if (node.type === CANVAS_ENTRY_NODE_TYPE) {
    const resource = asRecord(data?.resource);
    const explicitSelectionKey = nonEmptyString(resource?.selectionKey);
    if (explicitSelectionKey !== undefined) {
      return explicitSelectionKey;
    }
    const identity = canvasResourceIdentityFromNode(node);
    if (identity !== undefined) {
      return apBoundSurfaceKey({
        apName: identity.name,
        namespace: identity.namespace,
      });
    }
    return nonEmptyString(resource?.uid) ?? null;
  }

  return (
    nonEmptyString(data?.uid) ??
    nonEmptyString(asRecord(data?.states)?.uid) ??
    null
  );
}
