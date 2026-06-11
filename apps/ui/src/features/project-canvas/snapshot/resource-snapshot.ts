import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import {
  apLikeWorkloadKeysFromList,
  apsToCanvasState,
  dbsToCanvasState,
  entryPointsToCanvasState,
  templateNativeWorkloadsToCanvasState,
} from "@/features/project-canvas/flow/ap-list-to-canvas-state";
import {
  canvasConnectionEdgesFromDetectedConnections,
  detectCanvasConnections,
} from "@/features/project-canvas/flow/detected-connections";
import { mergeCanvasLayoutWithDetectedNodes } from "@/features/project-canvas/layout/merge";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
} from "@/features/project-canvas/layout/types";
import {
  type ApEnvironmentDbReferenceSource,
  apEnvironmentDbReferenceSourcesFromDbsData,
} from "@/features/project-settings/ap/k8s/db-dsn-reference-sources";
import { projectCanvasFrameState } from "./project-canvas-page-state";

export type ProjectCanvasLayoutIntent =
  | { kind: "first-placement"; nodes: CanvasLayoutNode[] }
  | { kind: "merge"; nodes: CanvasLayoutNode[] };

export interface ProjectCanvasResourceSnapshotInput {
  apsData?: K8sGetResponse;
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  dbsData?: K8sGetResponse;
  entryPointsData?: K8sGetResponse;
  error?: Error;
  isEmptyGraphLoading: boolean;
  kubeconfig: string;
  namespace: string;
  templateNativeData?: {
    deployments?: K8sGetResponse;
    statefulSets?: K8sGetResponse;
  };
}

export interface ProjectCanvasResourceSnapshot {
  apEnvironmentDbReferenceSources: ApEnvironmentDbReferenceSource[];
  canvasState: CanvasState;
  frameState: ReturnType<typeof projectCanvasFrameState>;
  layoutIntent: ProjectCanvasLayoutIntent | null;
}

const EMPTY_TEMPLATE_NATIVE_DATA = {};

export function buildProjectCanvasResourceSnapshot({
  apsData,
  canvasLayout,
  canvasLayoutReady = true,
  dbsData,
  entryPointsData,
  error,
  isEmptyGraphLoading,
  kubeconfig,
  namespace,
  templateNativeData = EMPTY_TEMPLATE_NATIVE_DATA,
}: ProjectCanvasResourceSnapshotInput): ProjectCanvasResourceSnapshot {
  const apEnvironmentDbReferenceSources =
    apEnvironmentDbReferenceSourcesFromDbsData(dbsData, namespace);
  const apBlock = apsToCanvasState(apsData, {
    gridIndexOffset: 0,
    namespaceFallback: namespace,
  });
  const dbBlock = dbsToCanvasState(dbsData, {
    gridIndexOffset: apBlock.nodes.length,
    namespaceFallback: namespace,
  });
  const entryPointBlock = entryPointsToCanvasState(entryPointsData, {
    apsData,
    gridIndexOffset: apBlock.nodes.length + dbBlock.nodes.length,
    namespaceFallback: namespace,
  });
  const apLikeWorkloadKeys = apLikeWorkloadKeysFromList(apsData, {
    namespaceFallback: namespace,
  });
  const templateNativeBlock = templateNativeWorkloadsToCanvasState(
    templateNativeData,
    {
      apLikeWorkloadKeys,
      gridIndexOffset:
        apBlock.nodes.length +
        dbBlock.nodes.length +
        entryPointBlock.nodes.length,
      namespaceFallback: namespace,
    }
  );
  const detectedNodes = [
    ...apBlock.nodes,
    ...dbBlock.nodes,
    ...entryPointBlock.nodes,
    ...templateNativeBlock.nodes,
  ];
  const detectedConnections = canvasLayoutReady
    ? detectCanvasConnections({
        apEnvironmentDbReferenceSources,
        apsData,
        dbsData,
        entryPointsData,
        namespaceFallback: namespace,
      })
    : [];
  const merge = canvasLayoutReady
    ? mergeCanvasLayoutWithDetectedNodes({
        connections: detectedConnections,
        layout: canvasLayout,
        nodes: detectedNodes,
      })
    : {
        changed: false,
        layout: canvasLayout,
        nodes: [],
        placedLayoutNodes: [],
      };
  const edges = canvasLayoutReady
    ? canvasConnectionEdgesFromDetectedConnections(
        detectedConnections,
        merge.nodes
      )
    : [];
  const canvasState: CanvasState = {
    edges: [...edges, ...templateNativeBlock.edges],
    nodes: merge.nodes,
    selectedEdge: null,
    selectedNode: null,
  };
  const layoutIntent = layoutIntentFromMerge({
    changed: merge.changed,
    layout: merge.layout,
    placedLayoutNodes: merge.placedLayoutNodes,
  });

  return {
    apEnvironmentDbReferenceSources,
    canvasState,
    frameState: projectCanvasFrameState({
      edgeCount: canvasState.edges.length,
      error,
      isEmptyGraphLoading,
      kubeconfig,
      nodeCount: canvasState.nodes.length,
    }),
    layoutIntent,
  };
}

function layoutIntentFromMerge(input: {
  changed: boolean;
  layout: CanvasLayoutDocument | undefined;
  placedLayoutNodes: CanvasLayoutNode[];
}): ProjectCanvasLayoutIntent | null {
  if (input.placedLayoutNodes.length > 0) {
    return { kind: "first-placement", nodes: input.placedLayoutNodes };
  }
  if (!(input.changed && input.layout !== undefined)) {
    return null;
  }
  return { kind: "merge", nodes: input.layout.nodes };
}
