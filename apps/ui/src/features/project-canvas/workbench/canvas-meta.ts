import type {
  CanvasMeta,
  CanvasReactFlowProps,
} from "@workspace/ui/components/canvas/canvas.types";
import type { CanvasNodeConnectionSide } from "@workspace/ui/components/canvas-node/canvas-node";
import type { Edge, Node } from "@xyflow/react";
import { projectCanvasFlowNodeTypes } from "@/features/project-canvas/canvas-store";
import {
  canvasNodeGeometryFromNode,
  selectCanvasAnchorPair,
} from "@/features/project-canvas/flow/anchor-pair";
import {
  type ProjectCanvasConnectionHandle,
  projectCanvasInteractionProps,
} from "@/features/project-canvas/flow/interaction";
import type { CanvasNodeSettingsAccess } from "@/features/project-canvas/nodes/types";
import type { ProjectCanvasSideRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import { planProjectCanvasCommand } from "@/features/project-canvas/workbench/command-model";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";

export interface ProjectCanvasConnectionOrigin {
  nodeId: string;
  side: CanvasNodeConnectionSide;
}

export const PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET = 640;

const CANVAS_NODE_CONNECTION_SIDES = new Set<string>([
  "bottom",
  "left",
  "right",
  "top",
]);

export function viewportFocusNodeIdFromSideRenderModel(
  side: ProjectCanvasSideRenderModel
): string | null {
  if (side?.kind !== "resource") {
    return null;
  }

  if (
    side.content.kind === "settings" &&
    side.content.target.target.kind === "AP" &&
    side.content.target.view === "public-addresses"
  ) {
    return side.content.entryNode?.id ?? null;
  }

  if (side.content.kind === "settings") {
    return side.content.node?.id ?? null;
  }

  return side.content.node.id;
}

export function sideRenderModelHasViewportFocusSession(
  side: ProjectCanvasSideRenderModel
): boolean {
  return side?.kind === "resource";
}

export function connectionOriginFromHandle(
  handle: ProjectCanvasConnectionHandle | null
): ProjectCanvasConnectionOrigin | null {
  if (
    handle?.nodeId == null ||
    handle.id == null ||
    !CANVAS_NODE_CONNECTION_SIDES.has(handle.id)
  ) {
    return null;
  }

  return {
    nodeId: handle.nodeId,
    side: handle.id as CanvasNodeConnectionSide,
  };
}

export function canvasNodeSettingsAccess({
  readOnly,
}: {
  readOnly: boolean;
}): CanvasNodeSettingsAccess | undefined {
  if (!readOnly) {
    return undefined;
  }
  return { readOnly: true };
}

export function createProjectCanvasMeta({
  clearSelection,
  connectionGestureActive,
  executeCommandPlan,
  focusCanvasSelection,
  frontCanvasNode,
  handleConnect,
  handleConnectEnd,
  handleConnectStart,
  isValidCanvasConnection,
  nodes,
  onNodePositionChange,
  projectCanvasConnectionLine,
  readOnly,
  viewportFocusActive,
  viewportFocusNodeId,
}: {
  clearSelection: () => void;
  connectionGestureActive: boolean;
  executeCommandPlan: (
    plan: ReturnType<typeof planProjectCanvasCommand>
  ) => void;
  focusCanvasSelection: (selection: ProjectCanvasSelection) => void;
  frontCanvasNode: (
    node: Node,
    options?: { persist?: boolean }
  ) => Node | undefined;
  handleConnect: NonNullable<CanvasReactFlowProps["onConnect"]>;
  handleConnectEnd: NonNullable<CanvasReactFlowProps["onConnectEnd"]>;
  handleConnectStart: NonNullable<CanvasReactFlowProps["onConnectStart"]>;
  isValidCanvasConnection: NonNullable<
    CanvasReactFlowProps["isValidConnection"]
  >;
  nodes: Node[];
  onNodePositionChange?: (node: Node) => void;
  projectCanvasConnectionLine: CanvasReactFlowProps["connectionLineComponent"];
  readOnly: boolean;
  viewportFocusActive: boolean;
  viewportFocusNodeId: string | null;
}): CanvasMeta {
  return {
    edgeAnchorResolver: ({ dragging, previousPair, sourceNode, targetNode }) =>
      selectCanvasAnchorPair({
        dragging,
        previousPair,
        source: canvasNodeGeometryFromNode(sourceNode),
        target: canvasNodeGeometryFromNode(targetNode),
      }),
    nodeTypes: projectCanvasFlowNodeTypes,
    reactFlowProps: {
      ...projectCanvasInteractionProps({
        isValidConnection: isValidCanvasConnection,
        onConnect: handleConnect,
        onConnectEnd: handleConnectEnd,
        onConnectStart: handleConnectStart,
        readOnly,
      }),
      className: connectionGestureActive
        ? "project-canvas-connection-active"
        : undefined,
      connectionLineComponent: readOnly
        ? undefined
        : projectCanvasConnectionLine,
      onEdgeClick: (_, edge: Edge) => {
        focusCanvasSelection({
          edgeId: edge.id,
          kind: "edge",
        });
      },
      onNodeClick: (_, node: Node) => {
        executeCommandPlan(
          planProjectCanvasCommand({
            intent: { kind: "nodeClick", node },
            nodes,
            readOnly,
          })
        );
      },
      onNodeDragStart: (_, node: Node) => {
        frontCanvasNode(node, { persist: false });
      },
      onNodeDragStop: (_, node: Node) => {
        if (!readOnly) {
          onNodePositionChange?.(
            frontCanvasNode(node, { persist: false }) ?? node
          );
        }
      },
      onPaneClick: () => clearSelection(),
    },
    viewportFocus: {
      active: viewportFocusActive,
      maxZoom: 1.05,
      minZoom: 0.85,
      nodeId: viewportFocusNodeId,
      rightInset: PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET,
    },
  };
}
