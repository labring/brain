import type { Node } from "@xyflow/react";

import {
  type ApBoundSurfaceKeyRef,
  apBoundSurfaceKey,
  apBoundSurfaceRefFromKey,
  canvasResourceIdentityFromNode,
} from "./resource-identity";

export type CanvasEntrySelectionRef = ApBoundSurfaceKeyRef;

export function entryPointSelectionKey({
  apName,
  namespace,
}: CanvasEntrySelectionRef): string {
  return apBoundSurfaceKey({ apName, namespace });
}

export function entryPointSelectionRefFromKey(
  key: string | null | undefined
): CanvasEntrySelectionRef | null {
  return apBoundSurfaceRefFromKey(key);
}

export function canvasHasApForEntrySelection(
  nodes: readonly Node[],
  selection: CanvasEntrySelectionRef
): boolean {
  return nodes.some((node) => {
    const identity = canvasResourceIdentityFromNode(node);
    return (
      identity?.kind === "AP" &&
      identity.namespace === selection.namespace &&
      identity.name === selection.apName
    );
  });
}
