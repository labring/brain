/* eslint-disable react-hooks/set-state-in-effect -- ported panel render-update patterns kept structurally intact */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useFrameMode } from "../frame-mode";
import { ICON_CLOSE, ICON_MOON, ICON_SUN } from "../icons";
import {
  blockPanelDragClick,
  getPanelDragHandle,
  getPanelDragOffset,
  getPanelDragStart,
  getPanelOriginX,
  hasPanelDragMoved,
} from "../panel-drag";
import {
  consumePanelReopenRequest,
  reportPanelOpenState,
} from "../panel-visibility";
import { DevTweaksStore, type PanelConfig } from "../store/dev-tweaks-store";
import { type MockEntry, MockStore } from "../store/mock-store";
import { TimelineStore } from "../store/timeline-store";
import {
  DEFAULT_PANEL_UI_PREFS,
  loadPanelUiPrefs,
  type PanelPosture,
  type PanelThemeChoice,
  savePanelUiPrefs,
} from "../ui-prefs";
import { useMediaQuery } from "../use-media-query";
import { Folder } from "./folder";
import { MockSection } from "./mock-section";
import { Panel } from "./panel";
import { ShortcutListener } from "./shortcut-listener";
import { TimelineToggleButton } from "./timeline/timeline-toggle-button";

export type DevTweaksPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";
export type DevTweaksMode = "popover" | "inline";
export type DevTweaksTheme = "light" | "dark" | "system";
/** Launcher bubble visibility while the panel is closed: always present, or
 * only while some panel value deviates from its default (dirty indicator). */
export type DevTweaksLauncher = "always" | "dirty";

interface DevTweaksRootProps {
  defaultOpen?: boolean;
  launcher?: DevTweaksLauncher;
  mode?: DevTweaksMode;
  onOpenChange?: (open: boolean) => void;
  position?: DevTweaksPosition;
  theme?: DevTweaksTheme;
}

/** Card inset on every side in frame posture, px. */
const FRAME_GAP = 32;
/** Width of the docked panel strip the card makes room for, px. */
const FRAME_PANEL_W = 340;
const FRAME_OPEN_MS = 300;
const FRAME_CLOSE_MS = 225;

/** Global toggle hotkey: ⌃⌥T opens and closes the panel. */
function useToggleHotkey(enabled: boolean, toggle: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === "KeyT") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, toggle]);
}

/**
 * Keeps the element in the top layer for its whole life. Frame posture
 * contains the body, and a contained body is the containing block for its
 * `position: fixed` children — the top layer is the only place left that
 * still measures against the viewport. The popover stays open throughout:
 * showing and hiding the panel is opacity/display, so transitions are
 * untouched. No-op where the platform has no popover support (the test DOM).
 */
function useTopLayer(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!(enabled && element && "showPopover" in element)) {
      return;
    }
    element.showPopover();
    return () => {
      if (element.isConnected) {
        element.hidePopover();
      }
    };
  }, [ref, enabled]);
}

/** True while any registered panel carries a value away from its default. */
function useAnyPanelDirty(panels: PanelConfig[]): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const unsubscribes = panels.map((panel) =>
        DevTweaksStore.subscribe(panel.id, callback)
      );
      return () => {
        for (const unsubscribe of unsubscribes) {
          unsubscribe();
        }
      };
    },
    [panels]
  );
  const getSnapshot = useCallback(
    () => panels.some((panel) => DevTweaksStore.isPanelDirty(panel.id)),
    [panels]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
export function DevTweaksRoot({
  position = "top-right",
  defaultOpen = true,
  launcher = "always",
  mode = "popover",
  theme = "dark",
  onOpenChange,
}: DevTweaksRootProps) {
  const [panels, setPanels] = useState<PanelConfig[]>([]);
  const [mocks, setMocks] = useState<MockEntry[]>([]);
  const [timelineCount, setTimelineCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inline = mode === "inline";

  // Root open state — controlled here so the hotkey, the bubble, and the
  // header all drive the same switch. A one-shot reopen request (armed by a
  // revalidation-by-reload while the panel was open) wins over defaultOpen.
  const [rootOpen, setRootOpen] = useState(
    () => inline || defaultOpen || consumePanelReopenRequest()
  );
  const rootOpenRef = useRef(rootOpen);
  const applyRootOpen = useCallback(
    (next: boolean) => {
      setRootOpen(next);
      reportPanelOpenState(next);
      if (rootOpenRef.current !== next) {
        rootOpenRef.current = next;
        onOpenChange?.(next);
      }
    },
    [onOpenChange]
  );
  const toggleRootOpen = useCallback(() => {
    applyRootOpen(!rootOpenRef.current);
  }, [applyRootOpen]);
  useToggleHotkey(!inline, toggleRootOpen);

  // Panel chrome prefs (posture + theme choice + dragged bubble position),
  // localStorage.
  const [posture, setPosture] = useState<PanelPosture>(
    DEFAULT_PANEL_UI_PREFS.posture
  );
  const [themeChoice, setThemeChoice] = useState<PanelThemeChoice | null>(null);
  const prefsLoadedRef = useRef(false);
  const narrow = useMediaQuery("(max-width: 1023px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");

  // Drag state
  const rootRef = useRef<HTMLDivElement>(null);
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

  // Adopt persisted chrome prefs once, on mount.
  useEffect(() => {
    const prefs = loadPanelUiPrefs();
    prefsLoadedRef.current = true;
    setPosture(prefs.posture);
    setThemeChoice(prefs.theme);
    if (prefs.floatOffset) {
      lastDragOffset.current = prefs.floatOffset;
      setDragOffset(prefs.floatOffset);
    }
  }, []);

  // Persist chrome prefs when the user changes them.
  useEffect(() => {
    if (!prefsLoadedRef.current) {
      return;
    }
    savePanelUiPrefs({
      floatOffset: dragOffset ?? lastDragOffset.current,
      posture,
      theme: themeChoice,
    });
  }, [posture, themeChoice, dragOffset]);

  // Theme: the prop is only the mount-time default; a header-toggle choice
  // wins and persists. "system" can only arrive via the prop, so the toggle
  // resolves it against the media query before flipping to the other side.
  const effectiveTheme = themeChoice ?? theme;
  const darkAppearance =
    effectiveTheme === "dark" || (effectiveTheme === "system" && systemDark);
  const toggleTheme = useCallback(() => {
    setThemeChoice(darkAppearance ? "light" : "dark");
  }, [darkAppearance]);

  // Narrow viewports force float; the remembered posture returns with width.
  const effectivePosture: PanelPosture = narrow ? "float" : posture;
  const framed = !inline && rootOpen && effectivePosture === "frame";
  let frameMs = framed ? FRAME_OPEN_MS : FRAME_CLOSE_MS;
  if (reducedMotion) {
    frameMs = 0;
  }
  useFrameMode({
    durationMs: frameMs,
    framed,
    gap: FRAME_GAP,
    panelWidth: FRAME_PANEL_W,
  });

  // Subscribe to registered editing surfaces. Timeline-backed panels render
  // in DevTweaksTimeline, but their presence adds a visibility toggle here.
  useEffect(() => {
    setMounted(true);
    reportPanelOpenState(rootOpenRef.current);
    setPanels(DevTweaksStore.getPanels("panel"));
    setMocks(MockStore.getMocks());
    setTimelineCount(TimelineStore.getTimelines().length);

    const unsubscribePanels = DevTweaksStore.subscribeGlobal(() => {
      setPanels(DevTweaksStore.getPanels("panel"));
    });
    const unsubscribeMocks = MockStore.subscribe(() => {
      setMocks(MockStore.getMocks());
    });
    const unsubscribeTimelines = TimelineStore.subscribeGlobal(() => {
      setTimelineCount(TimelineStore.getTimelines().length);
    });

    return () => {
      unsubscribePanels();
      unsubscribeMocks();
      unsubscribeTimelines();
    };
  }, []);

  // An enabled mock is dirty state: the page shows fixture data, not the real
  // thing, and the launcher must say so.
  const mockEnabled = mocks.some((mock) => mock.state.enabled);
  const dirty = useAnyPanelDirty(panels) || mockEnabled;

  // Watch for panel open/close — snap to corner on open, restore drag position on close
  useEffect(() => {
    if (!panelRef.current || inline) {
      return;
    }
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
    const observer = new MutationObserver(() => {
      const inners = panelRef.current?.querySelectorAll(
        ".dev-tweaks-panel-inner"
      );
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

  // The whole chrome rides the top layer so frame posture's contained body
  // cannot trap it. `hasSurfaces` is part of the switch because the root
  // renders null until a panel registers — the effect must re-run once the
  // popover element actually exists.
  const hasSurfaces =
    panels.length > 0 || mocks.length > 0 || timelineCount > 0;
  useTopLayer(rootRef, !inline && mounted && hasSurfaces);

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

  // Don't render on server
  if (!mounted || typeof window === "undefined") {
    return null;
  }

  // Don't render if no editing surfaces are registered.
  if (!hasSurfaces) {
    return null;
  }

  const dragStyle =
    dragOffset && !framed
      ? {
          top: dragOffset.y,
          left: dragOffset.x,
          right: "auto" as const,
          bottom: "auto" as const,
        }
      : undefined;
  const originX = getPanelOriginX(activePosition, dragOffset);
  // Mocks always render as sections under the root folder — they have no
  // root-panel variant — so any registered mock forces the sectioned layout.
  const hasMultiplePanels = panels.length > 1 || mocks.length > 0;
  const timelineToggle = timelineCount > 0 ? <TimelineToggleButton /> : null;

  // Header chrome controls: theme → posture → close. Posture and close hang
  // off the popover surface, so inline keeps only the theme toggle.
  const themeToggleTitle = darkAppearance
    ? "Switch to light theme"
    : "Switch to dark theme";
  const themeToggle = (
    <button
      aria-label={themeToggleTitle}
      className="dev-tweaks-header-button"
      onClick={toggleTheme}
      title={themeToggleTitle}
      type="button"
    >
      {darkAppearance ? (
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          {ICON_SUN.map((d) => (
            <path d={d} key={d} />
          ))}
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d={ICON_MOON} />
        </svg>
      )}
    </button>
  );

  let postureToggleTitle: string;
  if (narrow) {
    postureToggleTitle = "Docking needs a wider viewport";
  } else if (posture === "frame") {
    postureToggleTitle = "Switch to floating window";
  } else {
    postureToggleTitle = "Dock as frame";
  }
  const postureToggle = inline ? null : (
    <button
      aria-label={postureToggleTitle}
      className="dev-tweaks-header-button"
      disabled={narrow}
      onClick={() =>
        setPosture((prev) => (prev === "frame" ? "float" : "frame"))
      }
      title={postureToggleTitle}
      type="button"
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <rect
          height="16"
          rx="3"
          stroke="currentColor"
          strokeWidth="2"
          width="20"
          x="2"
          y="4"
        />
        <path
          d={posture === "frame" ? "M15 4v16" : "M15 4v16M15 8h7"}
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    </button>
  );

  const closeButton = inline ? null : (
    <button
      aria-label="Close panel"
      className="dev-tweaks-header-button"
      onClick={() => applyRootOpen(false)}
      title="Close (⌃⌥T)"
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d={ICON_CLOSE} />
      </svg>
    </button>
  );

  const headerActions = (
    <>
      {themeToggle}
      {postureToggle}
      {closeButton}
    </>
  );
  const rootToolbar = timelineToggle;

  const controlledOpen = inline ? undefined : rootOpen;
  // Dirty-only launcher: while closed and clean, the chrome disappears
  // entirely — ⌃⌥T remains the way in.
  const launcherHidden =
    !(inline || rootOpen) && launcher === "dirty" && !dirty;

  let panelPosition: DevTweaksPosition | undefined;
  if (!(inline || dragOffset || framed)) {
    panelPosition = activePosition;
  }

  let panelsContent: ReactNode;
  if (panels.length === 0 && mocks.length === 0) {
    panelsContent = (
      <div className="dev-tweaks-panel-wrapper">
        <Folder
          defaultOpen={inline || defaultOpen}
          fill={framed}
          headerActions={headerActions}
          inline={inline}
          isRoot={true}
          onOpenChange={applyRootOpen}
          open={controlledOpen}
          panelHeightOffset={2}
          title="Dev tweaks"
          toolbar={rootToolbar}
        >
          <div className="dev-tweaks-timeline-toolkit-only">Timeline</div>
        </Folder>
      </div>
    );
  } else if (hasMultiplePanels) {
    panelsContent = (
      <div className="dev-tweaks-panel-wrapper">
        <Folder
          defaultOpen={inline || defaultOpen}
          fill={framed}
          headerActions={headerActions}
          inline={inline}
          isRoot={true}
          onOpenChange={applyRootOpen}
          open={controlledOpen}
          panelHeightOffset={2}
          title="Dev tweaks"
          toolbar={rootToolbar}
        >
          {mocks.map((mock) => (
            <MockSection key={mock.key} mock={mock} />
          ))}
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
        fill={framed}
        headerActions={headerActions}
        inline={inline}
        key={panel.id}
        onOpenChange={applyRootOpen}
        open={controlledOpen}
        panel={panel}
        toolbarExtra={rootToolbar}
      />
    ));
  }

  const content = (
    <ShortcutListener>
      <div
        className="dev-tweaks-root"
        data-mode={mode}
        data-theme={effectiveTheme}
        popover={inline ? undefined : "manual"}
        ref={rootRef}
      >
        <div
          className="dev-tweaks-panel"
          data-mode={mode}
          data-multiple={hasMultiplePanels ? "true" : undefined}
          data-origin-x={inline ? undefined : originX}
          data-position={panelPosition}
          data-posture={framed ? "frame" : undefined}
          onPointerCancel={inline || framed ? undefined : handlePointerUp}
          onPointerDown={inline || framed ? undefined : handlePointerDown}
          onPointerMove={inline || framed ? undefined : handlePointerMove}
          onPointerUp={inline || framed ? undefined : handlePointerUp}
          ref={panelRef}
          style={{
            ...dragStyle,
            display: launcherHidden ? "none" : undefined,
          }}
          title={rootOpen ? undefined : "Dev tweaks (⌃⌥T)"}
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
