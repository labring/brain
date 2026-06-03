export type CanvasLayoutResourceKind = "AP" | "DB" | "EntryPoint";

export interface CanvasLayoutResourceRef {
  kind: CanvasLayoutResourceKind;
  name: string;
  namespace: string;
}

export interface CanvasLayoutPosition {
  x: number;
  y: number;
}

export interface CanvasLayoutNode {
  expanded?: boolean;
  lastSeenUid?: string;
  orphanedAt?: string;
  position: CanvasLayoutPosition;
  ref: CanvasLayoutResourceRef;
  stackOrder?: number;
}

export interface CanvasLayoutDocument {
  namespace: string;
  nodes: CanvasLayoutNode[];
  projectId: string;
  projectNameSnapshot?: string;
  /** Compatibility alias while existing canvas internals still use the old UID name. */
  projectUid: string;
  version: number;
}

export interface CanvasLayoutPatch {
  nodes: CanvasLayoutNode[];
  projectNameSnapshot?: string;
}
