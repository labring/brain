export type ProjectCanvasOverlay = "none" | "loading" | "error" | "empty";

export interface ProjectCanvasFrameStateInput {
  edgeCount: number;
  error?: Error;
  isEmptyGraphLoading: boolean;
  kubeconfig: string;
  nodeCount: number;
}

export interface ProjectCanvasFrameState {
  overlay: ProjectCanvasOverlay;
  renderCanvas: boolean;
}

export function projectCanvasFrameState({
  edgeCount,
  error,
  isEmptyGraphLoading,
  kubeconfig,
  nodeCount,
}: ProjectCanvasFrameStateInput): ProjectCanvasFrameState {
  if (kubeconfig.trim() === "") {
    return { overlay: "none", renderCanvas: false };
  }

  if (isEmptyGraphLoading) {
    return { overlay: "loading", renderCanvas: true };
  }

  const graphEmpty = nodeCount === 0 && edgeCount === 0;
  if (!graphEmpty) {
    return { overlay: "none", renderCanvas: true };
  }

  return {
    overlay: error == null ? "empty" : "error",
    renderCanvas: true,
  };
}
