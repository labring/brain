import type { Node, Viewport } from "@xyflow/react";
import type {
  CanvasMeta,
  CanvasViewportFocusRequest,
  CanvasViewportInsets,
} from "./canvas.types";
import {
  type CanvasViewportFocusAction,
  type CanvasViewportFocusNodeBounds,
  nodesBoundsForViewportFocus,
  resolveCanvasViewportFocus,
} from "./canvas.viewport-focus";

const VIEWPORT_FOCUS_DEFAULT_MIN_ZOOM = 0.85;
const VIEWPORT_FOCUS_DEFAULT_MAX_ZOOM = 1.05;

export interface CanvasViewportFocusRuntimeState {
  active: boolean;
  baseline: Viewport | null;
  initialized: boolean;
  lastFocusKey: string | null;
  lastRequestKey: string | null;
  targetKey: string | null;
  userControlled: boolean;
}

export const initialCanvasViewportFocusState: CanvasViewportFocusRuntimeState =
  {
    active: false,
    baseline: null,
    initialized: false,
    lastFocusKey: null,
    lastRequestKey: null,
    targetKey: null,
    userControlled: false,
  };

export function shouldRestoreViewportFocus(
  state: CanvasViewportFocusRuntimeState
): state is CanvasViewportFocusRuntimeState & { baseline: Viewport } {
  return state.active && state.baseline !== null && !state.userControlled;
}

export function shouldDeferViewportFocusRestore({
  state,
  viewportReady,
}: {
  state: CanvasViewportFocusRuntimeState;
  viewportReady: boolean;
}) {
  return shouldRestoreViewportFocus(state) && !viewportReady;
}

export function inactiveViewportFocusState({
  ready,
  state,
}: {
  ready: boolean;
  state: CanvasViewportFocusRuntimeState;
}): CanvasViewportFocusRuntimeState {
  if (state.active) {
    return {
      ...initialCanvasViewportFocusState,
      initialized: true,
    };
  }

  return {
    ...state,
    initialized: state.initialized || ready,
  };
}

export function suspendedViewportFocusState({
  getViewport,
  requestKey,
  state,
  targetKey,
  viewportReady,
}: {
  getViewport: () => Viewport;
  requestKey: string | null;
  state: CanvasViewportFocusRuntimeState;
  targetKey: string | null;
  viewportReady: boolean;
}): CanvasViewportFocusRuntimeState {
  const openingSession = !state.active;

  return {
    active: true,
    baseline:
      openingSession && state.initialized && viewportReady
        ? getViewport()
        : state.baseline,
    initialized: true,
    lastFocusKey: state.lastFocusKey,
    lastRequestKey: requestKey,
    targetKey,
    userControlled: state.userControlled,
  };
}

export function pendingViewportFocusState({
  getViewport,
  state,
}: {
  getViewport: () => Viewport;
  state: CanvasViewportFocusRuntimeState;
}): CanvasViewportFocusRuntimeState {
  const openingSession = !state.active;

  return {
    active: true,
    baseline:
      openingSession && state.initialized ? getViewport() : state.baseline,
    initialized: true,
    lastFocusKey: null,
    lastRequestKey: state.lastRequestKey,
    targetKey: null,
    userControlled: state.userControlled,
  };
}

export function focusedViewportFocusState({
  focusKey,
  getViewport,
  requestKey,
  state,
  targetKey,
}: {
  focusKey: string;
  getViewport: () => Viewport;
  requestKey: string | null;
  state: CanvasViewportFocusRuntimeState;
  targetKey: string;
}): CanvasViewportFocusRuntimeState {
  const openingSession = !state.active;
  const requestChanged = state.lastRequestKey !== requestKey;

  return {
    active: true,
    baseline:
      openingSession && state.initialized ? getViewport() : state.baseline,
    initialized: true,
    lastFocusKey: focusKey,
    lastRequestKey: requestKey,
    targetKey,
    userControlled: requestChanged ? false : state.userControlled,
  };
}

export function shouldApplyFocusedViewport({
  focusKey,
  requestKey,
  state,
  targetKey,
}: {
  focusKey: string;
  requestKey: string | null;
  state: CanvasViewportFocusRuntimeState;
  targetKey: string;
}): boolean {
  if (state.lastFocusKey === focusKey) {
    return false;
  }

  const requestChanged = state.lastRequestKey !== requestKey;
  const targetChanged = state.targetKey !== targetKey;
  return !(
    state.active &&
    state.userControlled &&
    !requestChanged &&
    !targetChanged
  );
}

export function userControlledViewportFocusState(
  state: CanvasViewportFocusRuntimeState
): CanvasViewportFocusRuntimeState {
  if (!(state.active && !state.userControlled)) {
    return state;
  }

  return {
    ...state,
    userControlled: true,
  };
}

export function canvasViewportFocusNodeIds(
  focus: CanvasMeta["viewportFocus"]
): string[] {
  return focus?.nodeIds.filter((nodeId) => nodeId.trim() !== "") ?? [];
}

export function canvasViewportFocusRequestKey(
  focus: CanvasMeta["viewportFocus"]
): string | null {
  return focus?.key == null ? null : String(focus.key);
}

export function canvasViewportFocusTargetKey(
  nodeIds: readonly string[]
): string | null {
  return nodeIds.length === 0 ? null : nodeIds.join("\0");
}

function viewportFocusNodesById(
  nodes: readonly Node[],
  nodeIds: readonly string[]
): Node[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodeIds.flatMap((nodeId) => {
    const node = byId.get(nodeId);
    return node === undefined ? [] : [node];
  });
}

function normalizeViewportInsets(
  insets: CanvasViewportInsets | undefined
): Required<CanvasViewportInsets> {
  return {
    bottom: Math.max(0, insets?.bottom ?? 0),
    right: Math.max(0, insets?.right ?? 0),
  };
}

function viewportFocusKey(input: {
  bottomInset: number;
  fitMinZoom: number;
  flowHeight: number;
  flowWidth: number;
  maxZoom: number;
  minZoom: number;
  padding: number;
  requestKey: string | null;
  rightInset: number;
  targetKey: string;
}): string {
  return [
    input.targetKey,
    input.requestKey ?? "",
    input.flowWidth,
    input.flowHeight,
    input.rightInset,
    input.bottomInset,
    input.padding,
    input.minZoom,
    input.fitMinZoom,
    input.maxZoom,
  ].join(":");
}

function viewportFocusZoom(input: { focus: CanvasViewportFocusRequest }): {
  fitMinZoom: number;
  maxZoom: number;
  minZoom: number;
  padding: number;
} {
  const minZoom = input.focus.minZoom ?? VIEWPORT_FOCUS_DEFAULT_MIN_ZOOM;
  return {
    fitMinZoom: input.focus.fitMinZoom ?? minZoom,
    maxZoom: input.focus.maxZoom ?? VIEWPORT_FOCUS_DEFAULT_MAX_ZOOM,
    minZoom,
    padding: Math.max(0, input.focus.padding ?? 0),
  };
}

function viewportFocusResolutionReady(input: {
  bounds: CanvasViewportFocusNodeBounds | null;
  focus: CanvasMeta["viewportFocus"];
  targetKey: string | null;
}): input is {
  bounds: CanvasViewportFocusNodeBounds;
  focus: CanvasViewportFocusRequest;
  targetKey: string;
} {
  return (
    input.bounds !== null &&
    input.focus !== undefined &&
    input.targetKey !== null
  );
}

export interface CanvasViewportFocusResolution {
  action: CanvasViewportFocusAction;
  focusKey: string;
  requestKey: string | null;
  targetKey: string;
}

export function resolveCanvasViewportFocusRequest({
  flowHeight,
  flowWidth,
  focus,
  nodeIds,
  nodes,
  targetKey,
  viewport,
  viewportInsets,
}: {
  flowHeight: number;
  flowWidth: number;
  focus: CanvasMeta["viewportFocus"];
  nodeIds: readonly string[];
  nodes: readonly Node[];
  targetKey: string | null;
  viewport: Viewport;
  viewportInsets: CanvasViewportInsets | undefined;
}): CanvasViewportFocusResolution | null {
  const focusNodes = viewportFocusNodesById(nodes, nodeIds);
  const focusBounds = nodesBoundsForViewportFocus(focusNodes);
  const focusResolution = {
    bounds: focusBounds,
    focus,
    targetKey,
  };

  if (!viewportFocusResolutionReady(focusResolution)) {
    return null;
  }

  const requestKey = canvasViewportFocusRequestKey(focusResolution.focus);
  const insets = normalizeViewportInsets(viewportInsets);
  const { fitMinZoom, maxZoom, minZoom, padding } = viewportFocusZoom({
    focus: focusResolution.focus,
  });
  const focusKey = viewportFocusKey({
    bottomInset: insets.bottom,
    fitMinZoom,
    flowHeight,
    flowWidth,
    maxZoom,
    minZoom,
    padding,
    requestKey,
    rightInset: insets.right,
    targetKey: focusResolution.targetKey,
  });
  const action = resolveCanvasViewportFocus({
    bottomInset: insets.bottom,
    flowHeight,
    flowWidth,
    fitMinZoom,
    maxZoom,
    minZoom,
    node: focusResolution.bounds,
    padding,
    rightInset: insets.right,
    viewport,
  });

  return {
    action,
    focusKey,
    requestKey,
    targetKey: focusResolution.targetKey,
  };
}
