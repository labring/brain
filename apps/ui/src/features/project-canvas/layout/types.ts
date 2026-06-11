export type CanvasLayoutResourceKind = "AP" | "DB" | "PublicAccess";

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
  version: number;
}

export interface CanvasLayoutPatch {
  intent?: "first-placement" | "layout";
  nodes: CanvasLayoutNode[];
  projectNameSnapshot?: string;
}
