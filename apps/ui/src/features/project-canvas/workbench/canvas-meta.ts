import type {
  CanvasFlowStore,
  CanvasMeta,
  CanvasReactFlowProps,
  CanvasViewportDirectiveStore,
  CanvasViewportFocusRequest,
} from "@workspace/ui/components/canvas/canvas.types";
import type { CanvasNodeConnectionSide } from "@workspace/ui/components/canvas-node/canvas-node";
import type { Edge, Node } from "@xyflow/react";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
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

export interface ProjectCanvasConnectionOrigin {
  nodeId: string;
  side: CanvasNodeConnectionSide;
}

const PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_FIT_MIN_ZOOM = 0.45;
const PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_PADDING = 32;
const PROJECT_CANVAS_NODE_EXTENT: NonNullable<
  CanvasReactFlowProps["nodeExtent"]
> = [
  [-1000, -1000],
  [4000, 2600],
];
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
  flowStore,
  focusCanvasSelection,
  frontCanvasNode,
  getNodes,
  handleConnect,
  handleConnectEnd,
  handleConnectStart,
  isValidCanvasConnection,
  onNodePositionChange,
  projectId,
  projectCanvasConnectionLine,
  readOnly,
  viewportDirectives,
}: {
  clearSelection: () => void;
  connectionGestureActive: boolean;
  executeCommandPlan: (
    plan: ReturnType<typeof planProjectCanvasCommand>
  ) => void;
  flowStore: CanvasFlowStore;
  focusCanvasSelection: (selection: ProjectCanvasSelection) => void;
  frontCanvasNode: (
    node: Node,
    options?: { persist?: boolean }
  ) => Node | undefined;
  /** Reads the current decorated canvas nodes at event time. */
  getNodes: () => readonly Node[];
  handleConnect: NonNullable<CanvasReactFlowProps["onConnect"]>;
  handleConnectEnd: NonNullable<CanvasReactFlowProps["onConnectEnd"]>;
  handleConnectStart: NonNullable<CanvasReactFlowProps["onConnectStart"]>;
  isValidCanvasConnection: NonNullable<
    CanvasReactFlowProps["isValidConnection"]
  >;
  onNodePositionChange?: (node: Node) => void;
  projectId?: string;
  projectCanvasConnectionLine: CanvasReactFlowProps["connectionLineComponent"];
  readOnly: boolean;
  viewportDirectives: CanvasViewportDirectiveStore;
}): CanvasMeta {
  return {
    edgeAnchorResolver: ({ dragging, previousPair, sourceNode, targetNode }) =>
      selectCanvasAnchorPair({
        dragging,
        previousPair,
        source: canvasNodeGeometryFromNode(sourceNode),
        target: canvasNodeGeometryFromNode(targetNode),
      }),
    flowStore,
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
      nodeExtent: PROJECT_CANVAS_NODE_EXTENT,
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
            nodes: getNodes(),
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
    viewportDirectives,
  };
}

/**
 * Builds the Project Canvas viewport focus directive for the current focus
 * target set, applying group fit tuning when more than one node is focused.
 */
export function projectCanvasViewportFocusRequest({
  active,
  key,
  nodeIds,
}: {
  active: boolean;
  key?: number | string;
  nodeIds: readonly string[];
}): CanvasViewportFocusRequest {
  const viewportFocusIsGroup = nodeIds.length > 1;
  return {
    active,
    fitMinZoom: viewportFocusIsGroup
      ? PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_FIT_MIN_ZOOM
      : undefined,
    key,
    maxZoom: 1.05,
    minZoom: 0.85,
    nodeIds,
    padding: viewportFocusIsGroup
      ? PROJECT_CANVAS_GROUP_VIEWPORT_FOCUS_PADDING
      : undefined,
  };
}
