/* eslint-disable react-hooks/set-state-in-effect -- ported DialKit render-update patterns kept structurally intact */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { isDevDefault } from "../env";
import {
  blockPanelDragClick,
  getPanelDragHandle,
  getPanelDragOffset,
  getPanelDragStart,
  getPanelOriginX,
  hasPanelDragMoved,
} from "../panel-drag";
import { DialStore, type PanelConfig } from "../store/dial-store";
import { TimelineStore } from "../store/timeline-store";
import { Folder } from "./folder";
import { Panel } from "./panel";
import { ShortcutListener } from "./shortcut-listener";
import { TimelineToggleButton } from "./timeline/timeline-toggle-button";

export type DialPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";
export type DialMode = "popover" | "inline";
export type DialTheme = "light" | "dark" | "system";

interface DialRootProps {
  defaultOpen?: boolean;
  mode?: DialMode;
  onOpenChange?: (open: boolean) => void;
  position?: DialPosition;
  productionEnabled?: boolean;
  theme?: DialTheme;
}

// The enabled gate lives in this wrapper so the impl component below never
// renders (and never runs hooks) when DialKit is off — an inline early return
// before the hooks would break the rules of hooks if the flag ever flipped.
export function DialRoot(props: DialRootProps) {
  if (!(props.productionEnabled ?? isDevDefault)) {
    return null;
  }
  return <DialRootImpl {...props} />;
}

function DialRootImpl({
  position = "top-right",
  defaultOpen = true,
  mode = "popover",
  theme = "system",
  onOpenChange,
}: DialRootProps) {
  const [panels, setPanels] = useState<PanelConfig[]>([]);
  const [timelineCount, setTimelineCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inline = mode === "inline";

  // Drag state
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null
  );
  const [activePosition, setActivePosition] = useState(position);
  const lastDragOffset = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    elX: number;
    elY: number;
  } | null>(null);
  const didDragRef = useRef(false);
  const dragTargetRef = useRef<HTMLElement | null>(null);
  const panelOpenStatesRef = useRef<Map<string, boolean>>(new Map());
  const rootOpenRef = useRef<boolean | null>(null);

  // Subscribe to registered editing surfaces. Timeline-backed panels render
  // in DialTimeline, but their presence adds a visibility toggle here.
  useEffect(() => {
    setMounted(true);
    setPanels(DialStore.getPanels("panel"));
    setTimelineCount(TimelineStore.getTimelines().length);

    const unsubscribePanels = DialStore.subscribeGlobal(() => {
      setPanels(DialStore.getPanels("panel"));
    });
    const unsubscribeTimelines = TimelineStore.subscribeGlobal(() => {
      setTimelineCount(TimelineStore.getTimelines().length);
    });

    return () => {
      unsubscribePanels();
      unsubscribeTimelines();
    };
  }, []);

  useEffect(() => {
    const fallbackOpen = inline || defaultOpen;
    const nextStates = new Map<string, boolean>();
    for (const panel of panels) {
      nextStates.set(
        panel.id,
        panelOpenStatesRef.current.get(panel.id) ?? fallbackOpen
      );
    }
    panelOpenStatesRef.current = nextStates;
    rootOpenRef.current = Array.from(nextStates.values()).some(Boolean);
  }, [defaultOpen, inline, panels]);

  // Watch for panel open/close — snap to corner on open, restore drag position on close
  useEffect(() => {
    if (!panelRef.current || inline) {
      return;
    }
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported DialKit logic kept structurally intact
    const observer = new MutationObserver(() => {
      const inners = panelRef.current?.querySelectorAll(".dialkit-panel-inner");
      if (!inners || inners.length === 0) {
        return;
      }
      const collapsed = Array.from(inners).every(
        (el) => el.getAttribute("data-collapsed") === "true"
      );
      const currentDragOffset = dragOffset;

      if (!collapsed) {
        // Opening — save drag position, determine corner, snap
        if (currentDragOffset) {
          lastDragOffset.current = currentDragOffset;
          const bubbleCenterX = currentDragOffset.x + 21;
          const midX = window.innerWidth / 2;
          setActivePosition(bubbleCenterX < midX ? "top-left" : "top-right");
        } else {
          setActivePosition(position);
        }
        setDragOffset(null);
      } else if (currentDragOffset) {
        lastDragOffset.current = currentDragOffset;
      } else if (lastDragOffset.current) {
        // Closing — restore the dragged position
        setDragOffset(lastDragOffset.current);
      }
    });
    observer.observe(panelRef.current, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-collapsed"],
    });
    return () => observer.disconnect();
  }, [inline, dragOffset, position]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const panel = panelRef.current;
    const handle = getPanelDragHandle(e.target, panel);
    if (!(panel && handle)) {
      return;
    }

    dragTargetRef.current = handle;
    dragStartRef.current = getPanelDragStart(e.clientX, e.clientY, panel);
    didDragRef.current = false;
    draggingRef.current = true;
    handle.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!(draggingRef.current && dragStartRef.current)) {
      return;
    }

    if (
      !(
        didDragRef.current ||
        hasPanelDragMoved(dragStartRef.current, e.clientX, e.clientY)
      )
    ) {
      return;
    }
    didDragRef.current = true;

    setDragOffset(
      getPanelDragOffset(dragStartRef.current, e.clientX, e.clientY)
    );
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    dragStartRef.current = null;
    const dragTarget = dragTargetRef.current;

    if (dragTarget?.hasPointerCapture(e.pointerId)) {
      dragTarget.releasePointerCapture(e.pointerId);
    }

    // If we actually dragged, prevent the click from opening the panel
    if (didDragRef.current) {
      e.stopPropagation();
      if (dragTarget) {
        blockPanelDragClick(dragTarget);
      }
    }
    dragTargetRef.current = null;
  }, []);

  const handlePanelOpenChange = useCallback(
    (panelId: string, open: boolean) => {
      panelOpenStatesRef.current.set(panelId, open);
      const fallbackOpen = inline || defaultOpen;
      const nextRootOpen = panels.some(
        (panel) => panelOpenStatesRef.current.get(panel.id) ?? fallbackOpen
      );

      if (rootOpenRef.current === nextRootOpen) {
        return;
      }
      rootOpenRef.current = nextRootOpen;
      onOpenChange?.(nextRootOpen);
    },
    [defaultOpen, inline, onOpenChange, panels]
  );

  const handleRootOpenChange = useCallback(
    (open: boolean) => {
      if (rootOpenRef.current === open) {
        return;
      }
      rootOpenRef.current = open;
      onOpenChange?.(open);
    },
    [onOpenChange]
  );

  // Don't render on server
  if (!mounted || typeof window === "undefined") {
    return null;
  }

  // Don't render if no editing surfaces are registered.
  if (panels.length === 0 && timelineCount === 0) {
    return null;
  }

  const dragStyle = dragOffset
    ? {
        top: dragOffset.y,
        left: dragOffset.x,
        right: "auto" as const,
        bottom: "auto" as const,
      }
    : undefined;
  const originX = getPanelOriginX(activePosition, dragOffset);
  const hasMultiplePanels = panels.length > 1;
  const timelineToggle = timelineCount > 0 ? <TimelineToggleButton /> : null;

  let panelPosition: DialPosition | undefined;
  if (!(inline || dragOffset)) {
    panelPosition = activePosition;
  }

  let panelsContent: ReactNode;
  if (panels.length === 0) {
    panelsContent = (
      <div className="dialkit-panel-wrapper">
        <Folder
          defaultOpen={inline || defaultOpen}
          inline={inline}
          isRoot={true}
          onOpenChange={handleRootOpenChange}
          panelHeightOffset={2}
          title="DialKit"
          toolbar={timelineToggle}
        >
          <div className="dialkit-timeline-toolkit-only">Timeline</div>
        </Folder>
      </div>
    );
  } else if (hasMultiplePanels) {
    panelsContent = (
      <div className="dialkit-panel-wrapper">
        <Folder
          defaultOpen={inline || defaultOpen}
          inline={inline}
          isRoot={true}
          onOpenChange={handleRootOpenChange}
          panelHeightOffset={2}
          title="DialKit"
          toolbar={timelineToggle}
        >
          {panels.map((panel) => (
            <Panel
              defaultOpen={true}
              key={panel.id}
              panel={panel}
              variant="section"
            />
          ))}
        </Folder>
      </div>
    );
  } else {
    panelsContent = panels.map((panel) => (
      <Panel
        defaultOpen={inline || defaultOpen}
        inline={inline}
        key={panel.id}
        onOpenChange={(open) => handlePanelOpenChange(panel.id, open)}
        panel={panel}
        toolbarExtra={timelineToggle}
      />
    ));
  }

  const content = (
    <ShortcutListener>
      <div className="dialkit-root" data-mode={mode} data-theme={theme}>
        <div
          className="dialkit-panel"
          data-mode={mode}
          data-multiple={hasMultiplePanels ? "true" : undefined}
          data-origin-x={inline ? undefined : originX}
          data-position={panelPosition}
          onPointerCancel={inline ? undefined : handlePointerUp}
          onPointerDown={inline ? undefined : handlePointerDown}
          onPointerMove={inline ? undefined : handlePointerMove}
          onPointerUp={inline ? undefined : handlePointerUp}
          ref={panelRef}
          style={dragStyle}
        >
          {panelsContent}
        </div>
      </div>
    </ShortcutListener>
  );

  if (inline) {
    return content;
  }

  return createPortal(content, document.body);
}
