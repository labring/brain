"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ReactNode,
  type RefCallback,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TransformComponent,
  TransformWrapper,
  useTransformContext,
} from "react-zoom-pan-pinch";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { BillingCostScope } from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

/** Grid unit of the pannable canvas; node anchors are expressed in grid cells. */
const GRID_SIZE = "2.5rem";
/** How far an edge runs straight out of a card before it may bend. */
const EDGE_OFFSET = 20;
const EDGE_BEND_RADIUS = 12;

const TOTAL_NODE_ID = "total";
const REGION_NODE_ID = "region";

export interface CostTreeWorkspace {
  cost: number;
  id: string;
  name: string;
}

interface BillingCostTreeProps {
  currency: BillingCurrency;
  isLoading: boolean;
  onScopeChange?: (scope: BillingCostScope) => void;
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

/** The workspace cards' 16px gradient dot, built from existing color tokens. */
function WorkspaceDot() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full bg-linear-to-br from-blue-400 to-brand-primary"
    />
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
}: BillingCostTreeProps) {
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
            icon={<WorkspaceDot />}
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

/**
 * The old Cost Center billing canvas: a full-width zoomable, pannable dot-grid
 * surface carrying the Total Cost → region → workspace card tree, connected by
 * orthogonal edges. Skinned with Brain V2.0 tokens.
 */
export function BillingCostTree(props: BillingCostTreeProps) {
  return (
    <div className="relative size-full overflow-hidden">
      <TransformWrapper
        centerOnInit={false}
        doubleClick={{ mode: "toggle" }}
        initialPositionX={32}
        initialPositionY={56}
        limitToBounds={false}
        maxScale={1.5}
        minScale={0.75}
        panning={{ wheelPanning: true }}
        wheel={{ smoothStep: 0.008 }}
      >
        <span className="pointer-events-none absolute top-5 left-5 z-20 rounded-full px-2 py-1 text-muted-foreground text-sm backdrop-blur-md">
          Select a card to view cost details
        </span>
        <DotGridBackdrop />
        <TransformComponent
          wrapperStyle={{ height: "100%", width: "100%", zIndex: 10 }}
        >
          <CostNodesCanvas {...props} />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
