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
import type { ProjectCanvasSideRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import { planProjectCanvasCommand } from "@/features/project-canvas/workbench/command-model";
import { projectCanvasNodeClickIntentFromNode } from "@/features/project-canvas/workbench/resource-surface-intents";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";

export interface ProjectCanvasConnectionOrigin {
  nodeId: string;
  side: CanvasNodeConnectionSide;
}

const PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_FIT_MIN_ZOOM = 0.45;
const PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_PADDING = 32;
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
  projectId,
  projectCanvasConnectionLine,
  readOnly,
  viewportFocusKey,
  viewportFocusActive,
  viewportFocusNodeIds,
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
  projectId?: string;
  projectCanvasConnectionLine: CanvasReactFlowProps["connectionLineComponent"];
  readOnly: boolean;
  viewportFocusKey?: number | string;
  viewportFocusActive: boolean;
  viewportFocusNodeIds: readonly string[];
}): CanvasMeta {
  const viewportFocusIsGroup = viewportFocusNodeIds.length > 1;

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
            intent: projectCanvasNodeClickIntentFromNode(node),
            nodes,
            projectId,
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
      fitMinZoom: viewportFocusIsGroup
        ? PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_FIT_MIN_ZOOM
        : undefined,
      key: viewportFocusKey,
      maxZoom: 1.05,
      minZoom: 0.85,
      nodeIds: viewportFocusNodeIds,
      padding: viewportFocusIsGroup
        ? PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_PADDING
        : undefined,
    },
  };
}
