"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { WorkspaceAvatar } from "@workspace/ui/components/workspace-avatar";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ReactNode,
  type RefCallback,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ReactZoomPanPinchContentRef,
  TransformComponent,
  TransformWrapper,
  useTransformContext,
} from "react-zoom-pan-pinch";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import {
  computeCostTreeFit,
  unionContentBounds,
} from "@/features/billing/billing-cost-tree-fit";
import type { BillingCostScope } from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

/** Grid unit of the pannable canvas; node anchors are expressed in grid cells. */
const GRID_SIZE = "2.5rem";
/** How far an edge runs straight out of a card before it may bend. */
const EDGE_OFFSET = 20;
const EDGE_BEND_RADIUS = 12;

const TOTAL_NODE_ID = "total";
const REGION_NODE_ID = "region";

/**
 * Base fit padding. Top is raised further at fit-time from the measured
 * "Select a card…" hint so scaled-down Total cards clear the fixed chip.
 */
const FIT_PADDING = { bottom: 16, left: 28, right: 16, top: 28 } as const;
/** Gap between the fixed hint chip bottom edge and the content top. */
const HINT_CLEARANCE_PX = 12;
const FIT_MIN_SCALE = 0.6;
/** Auto-fit never enlarges past natural card size; user zoom may go higher. */
const FIT_MAX_SCALE = 1;
const USER_MAX_SCALE = 1.5;
const REFIT_ANIMATION_MS = 200;
const RESIZE_REFIT_DEBOUNCE_MS = 120;

export interface CostTreeWorkspace {
  cost: number;
  id: string;
  name: string;
}

interface BillingCostTreeProps {
  currency: BillingCurrency;
  isLoading: boolean;
  onScopeChange?: (scope: BillingCostScope) => void;
  /** Width of the floating detail panel covering the right side of the canvas. */
  panelRightInset: number;
  regionCost: number;
  regionLabel: string;
  scope: BillingCostScope;
  workspaces: CostTreeWorkspace[];
}

interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** One rounded corner of an orthogonal edge, mirroring the old smooth-step path. */
function bendSegment(a: Point, b: Point, c: Point): string {
  const size = Math.min(
    distance(a, b) / 2,
    distance(b, c) / 2,
    EDGE_BEND_RADIUS
  );
  if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
    return `L${b.x} ${b.y}`;
  }
  if (a.y === b.y) {
    const xDir = a.x < c.x ? -1 : 1;
    const yDir = a.y < c.y ? 1 : -1;
    return `L ${b.x + size * xDir},${b.y}Q ${b.x},${b.y} ${b.x},${b.y + size * yDir}`;
  }
  const xDir = a.x < c.x ? 1 : -1;
  const yDir = a.y < c.y ? -1 : 1;
  return `L ${b.x},${b.y + size * yDir}Q ${b.x},${b.y} ${b.x + size * xDir},${b.y}`;
}

function orthogonalPath(points: Point[]): string {
  return points
    .map((point, index) => {
      const previous = points[index - 1];
      const next = points[index + 1];
      if (index === 0) {
        return `M${point.x} ${point.y}`;
      }
      if (previous == null || next == null) {
        return `L${point.x} ${point.y}`;
      }
      return bendSegment(previous, point, next);
    })
    .join("");
}

/** Edge leaving the bottom of the total card, elbowing right into a region card. */
function bottomToLeftPath(from: Point, to: Point): string {
  return orthogonalPath([
    from,
    { x: from.x, y: from.y + EDGE_OFFSET },
    { x: from.x, y: to.y },
    { x: to.x - EDGE_OFFSET, y: to.y },
    to,
  ]);
}

/** Edge leaving the right of a region card, stepping across into a workspace card. */
function rightToLeftPath(from: Point, to: Point): string {
  const centerX = (from.x + to.x) / 2;
  return orthogonalPath([
    from,
    { x: from.x + EDGE_OFFSET, y: from.y },
    { x: centerX, y: from.y },
    { x: centerX, y: to.y },
    { x: to.x - EDGE_OFFSET, y: to.y },
    to,
  ]);
}

/** The dotted backdrop behind the cost tree; static, it does not pan or zoom. */
function DotGridBackdrop() {
  const patternId = useId();
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full bg-muted/20 text-muted-foreground/50"
    >
      <pattern
        height="40"
        id={patternId}
        patternUnits="userSpaceOnUse"
        width="40"
      >
        <circle cx="16" cy="16" fill="currentColor" r="0.75" />
      </pattern>
      <rect fill={`url(#${patternId})`} height="100%" width="100%" />
    </svg>
  );
}

function CostScopeCard({
  cost,
  currency,
  icon,
  isLoading,
  name,
  onClick,
  selected,
}: {
  cost: number;
  currency: BillingCurrency;
  icon?: ReactNode;
  isLoading: boolean;
  name: string;
  onClick?: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex w-37.5 flex-col items-start gap-1 rounded-lg border border-muted-foreground/50 border-dashed bg-card p-3 text-left shadow-xs transition-colors hover:border-blue-400",
        selected && "border border-blue-400 border-solid"
      )}
      data-slot="billing-cost-scope-card"
      onClick={onClick}
      type="button"
    >
      <span className="flex w-full items-center gap-2">
        {icon}
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground text-sm"
          title={name}
        >
          {name}
        </span>
      </span>
      {isLoading ? (
        <Skeleton className="h-6 w-16" />
      ) : (
        <span
          className={cn(
            "font-bold tabular-nums",
            selected ? "text-blue-400" : "text-foreground"
          )}
        >
          {formatBillingAmount(cost, currency)}
        </span>
      )}
    </button>
  );
}

/** Lightweight stand-in cards while the first fit is computed. */
function CostTreeSkeleton() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-15"
      data-slot="billing-cost-tree-skeleton"
    >
      <div
        className="absolute"
        style={{
          transform: `translate(calc(0 * ${GRID_SIZE}), calc(0 * ${GRID_SIZE}))`,
        }}
      >
        <div className="flex w-37.5 flex-col gap-1 rounded-lg border border-muted-foreground/30 border-dashed bg-card/80 p-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
      <div
        className="absolute"
        style={{
          transform: `translate(calc(3 * ${GRID_SIZE}), calc(3 * ${GRID_SIZE}))`,
        }}
      >
        <div className="flex w-37.5 flex-col gap-1 rounded-lg border border-muted-foreground/30 border-dashed bg-card/80 p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
      <div
        className="absolute"
        style={{
          transform: `translate(calc(9.5 * ${GRID_SIZE}), calc(4.5 * ${GRID_SIZE}))`,
        }}
      >
        <div className="flex w-37.5 flex-col gap-1 rounded-lg border border-muted-foreground/30 border-dashed bg-card/80 p-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
      <div
        className="absolute"
        style={{
          transform: `translate(calc(9.5 * ${GRID_SIZE}), calc(7 * ${GRID_SIZE}))`,
        }}
      >
        <div className="flex w-37.5 flex-col gap-1 rounded-lg border border-muted-foreground/30 border-dashed bg-card/80 p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-14" />
        </div>
      </div>
    </div>
  );
}

/** A card anchored on the pannable canvas at grid-cell coordinates. */
function CanvasNode({
  anchorX,
  anchorY,
  children,
  nodeRef,
}: {
  anchorX: number;
  anchorY: number;
  children: ReactNode;
  nodeRef?: RefCallback<HTMLDivElement>;
}) {
  return (
    <div
      className="absolute"
      data-slot="billing-cost-tree-node"
      ref={nodeRef}
      style={{
        transform: `translate(calc(${anchorX} * ${GRID_SIZE}), calc(${anchorY} * ${GRID_SIZE}))`,
      }}
    >
      {children}
    </div>
  );
}

interface TreeEdge {
  d: string;
  highlighted: boolean;
  id: string;
}

function edgeAnchors(
  wrapperRect: DOMRect,
  scale: number,
  fromRect: DOMRect,
  toRect: DOMRect,
  fromSide: "bottom" | "right"
): { from: Point; to: Point } {
  const from =
    fromSide === "bottom"
      ? {
          x: fromRect.left + fromRect.width / 2 - wrapperRect.left,
          y: fromRect.bottom - wrapperRect.top,
        }
      : {
          x: fromRect.right - wrapperRect.left,
          y: fromRect.top + fromRect.height / 2 - wrapperRect.top,
        };
  const to = {
    x: toRect.left - wrapperRect.left,
    y: toRect.top + toRect.height / 2 - wrapperRect.top,
  };
  // Coordinates land in the transformed content space, so undo the zoom scale.
  return {
    from: { x: from.x / scale, y: from.y / scale },
    to: { x: to.x / scale, y: to.y / scale },
  };
}

function CostNodesCanvas({
  currency,
  isLoading,
  onScopeChange,
  regionCost,
  regionLabel,
  scope,
  workspaces,
  onNodesChange,
}: BillingCostTreeProps & {
  onNodesChange: (elements: Map<string, HTMLElement>) => void;
}) {
  const transformContext = useTransformContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [nodeElements, setNodeElements] = useState<Map<string, HTMLElement>>(
    new Map()
  );
  // Stable per-node ref callbacks so re-renders do not loop on ref identity.
  const nodeRefCallbacks = useRef(
    new Map<string, RefCallback<HTMLDivElement>>()
  );
  const getRefForNode = useCallback((id: string) => {
    let callback = nodeRefCallbacks.current.get(id);
    if (!callback) {
      callback = (element) => {
        setNodeElements((previous) => {
          const current = previous.get(id) ?? null;
          if (current === element) {
            return previous;
          }
          const next = new Map(previous);
          if (element) {
            next.set(id, element);
          } else {
            next.delete(id);
          }
          return next;
        });
      };
      nodeRefCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  useEffect(() => {
    onNodesChange(nodeElements);
  }, [nodeElements, onNodesChange]);

  // Old Cost Center behavior: workspace cards appear once a region is chosen.
  const visibleWorkspaces = scope.kind === "total" ? [] : workspaces;
  const selectedWorkspace = scope.kind === "workspace" ? scope.workspace : null;

  const edges = useMemo(() => {
    const collected: TreeEdge[] = [];
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return collected;
    }
    const wrapperRect = wrapper.getBoundingClientRect();
    const scale = transformContext.transformState.scale;
    const totalElement = nodeElements.get(TOTAL_NODE_ID);
    const regionElement = nodeElements.get(REGION_NODE_ID);
    if (totalElement && regionElement) {
      const { from, to } = edgeAnchors(
        wrapperRect,
        scale,
        totalElement.getBoundingClientRect(),
        regionElement.getBoundingClientRect(),
        "bottom"
      );
      collected.push({
        d: bottomToLeftPath(from, to),
        highlighted: scope.kind !== "total",
        id: REGION_NODE_ID,
      });
    }
    if (regionElement) {
      for (const workspace of visibleWorkspaces) {
        const workspaceElement = nodeElements.get(workspace.id);
        if (!workspaceElement) {
          continue;
        }
        const { from, to } = edgeAnchors(
          wrapperRect,
          scale,
          regionElement.getBoundingClientRect(),
          workspaceElement.getBoundingClientRect(),
          "right"
        );
        collected.push({
          d: rightToLeftPath(from, to),
          highlighted: selectedWorkspace === workspace.id,
          id: workspace.id,
        });
      }
    }
    return collected;
  }, [
    nodeElements,
    scope.kind,
    selectedWorkspace,
    transformContext.transformState.scale,
    visibleWorkspaces,
  ]);

  return (
    <div className="relative h-px w-px" ref={wrapperRef}>
      <svg
        aria-hidden="true"
        className="absolute -z-10 size-full overflow-visible"
        fill="none"
      >
        <g>
          {edges
            .filter((edge) => !edge.highlighted)
            .map((edge) => (
              <path
                className="stroke-muted-foreground/40"
                d={edge.d}
                key={edge.id}
                strokeDasharray="2 2"
                strokeWidth="1"
              />
            ))}
        </g>
        <g>
          {edges
            .filter((edge) => edge.highlighted)
            .map((edge) => (
              <path
                className="stroke-blue-400"
                d={edge.d}
                key={edge.id}
                strokeWidth="1"
              />
            ))}
        </g>
      </svg>

      <CanvasNode
        anchorX={0}
        anchorY={0}
        nodeRef={getRefForNode(TOTAL_NODE_ID)}
      >
        <CostScopeCard
          cost={regionCost}
          currency={currency}
          isLoading={isLoading}
          name="Total Cost"
          onClick={() => onScopeChange?.({ kind: "total" })}
          selected={scope.kind === "total"}
        />
      </CanvasNode>
      <CanvasNode
        anchorX={3}
        anchorY={3}
        nodeRef={getRefForNode(REGION_NODE_ID)}
      >
        <CostScopeCard
          cost={regionCost}
          currency={currency}
          isLoading={isLoading}
          name={regionLabel}
          onClick={() => onScopeChange?.({ kind: "region" })}
          selected={scope.kind !== "total"}
        />
      </CanvasNode>
      {visibleWorkspaces.map((workspace, index) => (
        <CanvasNode
          anchorX={9.5}
          anchorY={4.5 + index * 2.5}
          key={workspace.id}
          nodeRef={getRefForNode(workspace.id)}
        >
          <CostScopeCard
            cost={workspace.cost}
            currency={currency}
            icon={
              <WorkspaceAvatar className="size-4" workspaceId={workspace.id} />
            }
            isLoading={isLoading}
            name={workspace.name}
            onClick={() =>
              onScopeChange?.({ kind: "workspace", workspace: workspace.id })
            }
            selected={selectedWorkspace === workspace.id}
          />
        </CanvasNode>
      ))}
    </div>
  );
}

function measureNodeBoundsInContentSpace(
  nodeElements: Map<string, HTMLElement>,
  contentComponent: HTMLElement,
  scale: number
) {
  const safeScale = scale === 0 ? 1 : scale;
  const contentRect = contentComponent.getBoundingClientRect();
  const rects: { height: number; width: number; x: number; y: number }[] = [];
  for (const element of nodeElements.values()) {
    const rect = element.getBoundingClientRect();
    rects.push({
      height: rect.height / safeScale,
      width: rect.width / safeScale,
      x: (rect.left - contentRect.left) / safeScale,
      y: (rect.top - contentRect.top) / safeScale,
    });
  }
  return unionContentBounds(rects);
}

function readViewportSize(container: HTMLElement): {
  height: number;
  width: number;
} | null {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { height, width };
}

function canAttemptCostTreeFit(options: {
  expectedNodeCount: number;
  isLoading: boolean;
  nodeCount: number;
  panelRightInset: number;
  userHasControl: boolean;
}): boolean {
  if (options.userHasControl || options.isLoading) {
    return false;
  }
  if (options.panelRightInset <= 0) {
    return false;
  }
  return options.nodeCount >= options.expectedNodeCount;
}

function runProgrammaticTransform(
  api: ReactZoomPanPinchContentRef,
  fit: { positionX: number; positionY: number; scale: number },
  animated: boolean,
  programmaticFitRef: { current: boolean },
  clearTimerRef: { current: ReturnType<typeof setTimeout> | null }
) {
  if (clearTimerRef.current != null) {
    clearTimeout(clearTimerRef.current);
  }
  programmaticFitRef.current = true;
  api.setTransform(
    fit.positionX,
    fit.positionY,
    fit.scale,
    animated ? REFIT_ANIMATION_MS : 0,
    "easeOut"
  );
  clearTimerRef.current = setTimeout(
    () => {
      programmaticFitRef.current = false;
      clearTimerRef.current = null;
    },
    animated ? REFIT_ANIMATION_MS + 32 : 0
  );
}

/**
 * The old Cost Center billing canvas: a full-width zoomable, pannable dot-grid
 * surface carrying the Total Cost → region → workspace card tree, connected by
 * orthogonal edges. Skinned with Brain V2.0 tokens.
 *
 * Auto-fits visible nodes into the usable viewport (container minus the right
 * detail panel) once data and layout are ready, and re-fits on tree geometry
 * or resize until the user takes over pan/zoom.
 */
export function BillingCostTree({
  panelRightInset,
  ...props
}: BillingCostTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const nodeElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const userHasControlRef = useRef(false);
  const programmaticFitRef = useRef(false);
  const programmaticClearTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealedRef = useRef(false);
  const lastGeometryKeyRef = useRef<string | null>(null);
  const lastFitViewportRef = useRef({
    height: 0,
    panelRightInset: 0,
    width: 0,
  });

  const [revealed, setRevealed] = useState(false);
  const [measuredNodeCount, setMeasuredNodeCount] = useState(0);
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 });

  const visibleWorkspaceIds = useMemo(() => {
    if (props.scope.kind === "total") {
      return [] as string[];
    }
    return props.workspaces.map((workspace) => workspace.id);
  }, [props.scope.kind, props.workspaces]);

  const expectedNodeCount = 2 + visibleWorkspaceIds.length;
  const geometryKey = `${props.scope.kind}|${visibleWorkspaceIds.join(",")}`;

  const onNodesChange = useCallback((elements: Map<string, HTMLElement>) => {
    nodeElementsRef.current = elements;
    setMeasuredNodeCount(elements.size);
  }, []);

  const markUserControl = useCallback(() => {
    if (programmaticFitRef.current) {
      return;
    }
    userHasControlRef.current = true;
  }, []);

  const applyFit = useCallback(
    (animated: boolean) => {
      if (
        !canAttemptCostTreeFit({
          expectedNodeCount,
          isLoading: props.isLoading,
          nodeCount: nodeElementsRef.current.size,
          panelRightInset,
          userHasControl: userHasControlRef.current,
        })
      ) {
        return false;
      }

      const container = containerRef.current;
      const api = transformRef.current;
      const content = api?.instance.contentComponent;
      if (!(container && api && content)) {
        return false;
      }

      const viewport = readViewportSize(container);
      if (!viewport) {
        return false;
      }

      const bounds = measureNodeBoundsInContentSpace(
        nodeElementsRef.current,
        content,
        api.instance.transformState.scale
      );
      if (!bounds) {
        return false;
      }

      // Hint sits outside the transform; measure it so fit top padding clears it
      // even when cards shrink under auto-fit scale.
      const containerRect = container.getBoundingClientRect();
      const hintRect = hintRef.current?.getBoundingClientRect();
      const hintBottomInset =
        hintRect == null
          ? 0
          : hintRect.bottom - containerRect.top + HINT_CLEARANCE_PX;
      const padding = {
        ...FIT_PADDING,
        top: Math.max(FIT_PADDING.top, hintBottomInset),
      };

      const fit = computeCostTreeFit({
        bounds,
        maxScale: FIT_MAX_SCALE,
        minScale: FIT_MIN_SCALE,
        padding,
        panelRightInset,
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
      });

      runProgrammaticTransform(
        api,
        fit,
        animated,
        programmaticFitRef,
        programmaticClearTimerRef
      );

      if (!revealedRef.current) {
        revealedRef.current = true;
        setRevealed(true);
      }
      lastGeometryKeyRef.current = geometryKey;
      lastFitViewportRef.current = {
        height: viewport.height,
        panelRightInset,
        width: viewport.width,
      };
      return true;
    },
    [expectedNodeCount, geometryKey, panelRightInset, props.isLoading]
  );

  // Track container size for resize re-fit.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const updateSize = () => {
      setViewportSize({
        height: container.clientHeight,
        width: container.clientWidth,
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // First fit (instant) and geometry re-fit (animated).
  useLayoutEffect(() => {
    if (
      !canAttemptCostTreeFit({
        expectedNodeCount,
        isLoading: props.isLoading,
        nodeCount: measuredNodeCount,
        panelRightInset,
        userHasControl: userHasControlRef.current,
      })
    ) {
      return;
    }
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    const isFirst = !revealedRef.current;
    const geometryChanged = lastGeometryKeyRef.current !== geometryKey;
    if (!(isFirst || geometryChanged)) {
      return;
    }

    // Wait a frame so cards finish layout after data/scope changes.
    const frame = requestAnimationFrame(() => {
      applyFit(!isFirst);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    applyFit,
    expectedNodeCount,
    geometryKey,
    measuredNodeCount,
    panelRightInset,
    props.isLoading,
    viewportSize.height,
    viewportSize.width,
  ]);

  // Resize re-fit (debounced), only while the user has not taken over.
  useEffect(() => {
    if (!revealedRef.current || userHasControlRef.current) {
      return;
    }
    const last = lastFitViewportRef.current;
    if (
      last.width === viewportSize.width &&
      last.height === viewportSize.height &&
      last.panelRightInset === panelRightInset
    ) {
      return;
    }
    if (resizeTimerRef.current != null) {
      clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      applyFit(true);
    }, RESIZE_REFIT_DEBOUNCE_MS);
    return () => {
      if (resizeTimerRef.current != null) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [applyFit, panelRightInset, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    return () => {
      if (programmaticClearTimerRef.current != null) {
        clearTimeout(programmaticClearTimerRef.current);
      }
      if (resizeTimerRef.current != null) {
        clearTimeout(resizeTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className="relative size-full overflow-hidden"
      data-slot="billing-cost-tree"
      ref={containerRef}
    >
      <TransformWrapper
        centerOnInit={false}
        doubleClick={{ disabled: !revealed, mode: "toggle" }}
        initialPositionX={0}
        initialPositionY={0}
        initialScale={1}
        limitToBounds={false}
        maxScale={USER_MAX_SCALE}
        minScale={FIT_MIN_SCALE}
        onPanningStart={markUserControl}
        onPinchingStart={markUserControl}
        onWheelStart={markUserControl}
        onZoomStart={markUserControl}
        panning={{ disabled: !revealed, wheelPanning: true }}
        pinch={{ disabled: !revealed }}
        ref={transformRef}
        wheel={{ disabled: !revealed, smoothStep: 0.008 }}
      >
        <span
          className="pointer-events-none absolute top-5 left-5 z-20 rounded-full px-2 py-1 text-muted-foreground text-sm backdrop-blur-md"
          ref={hintRef}
        >
          Select a card to view cost details
        </span>
        <DotGridBackdrop />
        {revealed ? null : <CostTreeSkeleton />}
        <TransformComponent
          contentClass={cn(!revealed && "pointer-events-none opacity-0")}
          wrapperStyle={{ height: "100%", width: "100%", zIndex: 10 }}
        >
          <CostNodesCanvas
            {...props}
            onNodesChange={onNodesChange}
            panelRightInset={panelRightInset}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
