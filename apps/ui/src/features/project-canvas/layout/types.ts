export type CanvasLayoutResourceKind = "AP" | "DB" | "PublicAccess";
export type CanvasPlacementSource = "generated" | "user";

export interface CanvasLayoutResourceRef {
  kind: CanvasLayoutResourceKind;
  name: string;
  namespace: string;
}

export type CanvasPlacementOwner =
  | { kind: "resource"; ref: CanvasLayoutResourceRef }
  | { kind: "deploymentProjection"; slotId: string; taskId: string };

export interface CanvasLayoutPosition {
  x: number;
  y: number;
}

interface CanvasLayoutNodeBase {
  expanded?: boolean;
  lastSeenUid?: string;
  orphanedAt?: string;
  owner: CanvasPlacementOwner;
  position: CanvasLayoutPosition;
  source?: CanvasPlacementSource;
  stackOrder?: number;
}

export interface CanvasResourceLayoutNode extends CanvasLayoutNodeBase {
  owner: Extract<CanvasPlacementOwner, { kind: "resource" }>;
}

export interface CanvasDeploymentProjectionLayoutNode
  extends CanvasLayoutNodeBase {
  owner: Extract<CanvasPlacementOwner, { kind: "deploymentProjection" }>;
}

export type CanvasLayoutNode =
  | CanvasDeploymentProjectionLayoutNode
  | CanvasResourceLayoutNode;

export type PlacementCommand =
  | {
      kind: "create";
      owner: CanvasPlacementOwner;
      position: CanvasLayoutPosition;
      source: CanvasPlacementSource;
    }
  | {
      kind: "move";
      owner: CanvasPlacementOwner;
      position: CanvasLayoutPosition;
      source: CanvasPlacementSource;
    }
  | {
      fromOwner: CanvasPlacementOwner;
      kind: "rekey";
      toOwner: CanvasPlacementOwner;
    }
  | {
      kind: "delete";
      owner: CanvasPlacementOwner;
    };

export interface CanvasLayoutDocument {
  namespace: string;
  nodes: CanvasLayoutNode[];
  projectId: string;
  projectNameSnapshot?: string;
  version: number;
}

export interface CanvasLayoutPatch {
  commands?: PlacementCommand[];
  expectedVersion?: number;
  intent?: "first-placement" | "layout";
  nodes: CanvasLayoutNode[];
  projectNameSnapshot?: string;
}
