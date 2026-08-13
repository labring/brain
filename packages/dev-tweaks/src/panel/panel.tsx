"use client";

import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useDevTweaksStore } from "../provider";
import type { DevTweaksStore } from "../store";
import type {
  DevTweaksActiveEntry,
  DevTweaksRegisteredGroup,
  DevTweaksValue,
} from "../types";
import { ControlRow } from "./controls";
import {
  IconChevron,
  IconClose,
  IconDock,
  IconFloat,
  IconReset,
} from "./icons";
import {
  DEFAULT_PANEL_PREFS,
  loadPanelPrefs,
  type PanelCorner,
  type PanelMode,
  type PanelPrefs,
  savePanelPrefs,
} from "./ui-prefs";
import { useMediaQuery } from "./use-media-query";

const PANEL_W = 384;
const FRAME_GAP = 32;
const FLOAT_W = 320;
const FLOAT_MARGIN = 16;
const FLOAT_MIN_H = 280;
const OPEN_MS = 300;
const CLOSE_MS = 225;
const FLOAT_FADE_MS = 150;
const HANDOFF_MS = 200;
const SNAP_MS = 200;
const HIGHLIGHT_MS = 1400;

export interface DevTweaksPanelProps {
  /** The host app — in frame mode it docks into an inset card. */
  children?: ReactNode;
  /**
   * Host bridge variables (`--dtp-font-sans`, `--dtp-font-mono`,
   * `--dtp-card-bg`, `--dtp-card-ring`) — applied to all panel chrome.
   */
  style?: CSSProperties;
}

/**
 * The panel plus the frame mechanism. Wrap the app's children with it inside
 * the DevTweaksProvider; without a Provider it renders children untouched.
 */
export function DevTweaksPanel({ children, style }: DevTweaksPanelProps) {
  const store = useDevTweaksStore();
  if (!store) {
    return <>{children}</>;
  }
  return (
    <PanelChrome store={store} style={style}>
      {children}
    </PanelChrome>
  );
}

function useTogglesHotkey(store: DevTweaksStore) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === "KeyT") {
        event.preventDefault();
        store.setOpen(!store.isOpen());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}

function PanelChrome({
  children,
  store,
  style,
}: DevTweaksPanelProps & { store: DevTweaksStore }) {
  const open = useSyncExternalStore(
    store.subscribe,
    store.isOpen,
    store.isOpen
  );
  const narrow = useMediaQuery("(max-width: 1023px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Start from defaults on both server and first client render (hydration
  // must match); the persisted prefs land right after mount.
  const [prefs, setPrefs] = useState<PanelPrefs>(DEFAULT_PANEL_PREFS);
  useEffect(() => {
    setPrefs(loadPanelPrefs());
  }, []);

  useTogglesHotkey(store);

  const updatePrefs = (patch: Partial<PanelPrefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch };
      savePanelPrefs(next);
      return next;
    });
  };

  // Narrow viewports force float; the remembered mode returns with the width.
  const mode: PanelMode = narrow ? "float" : prefs.mode;
  const framed = open && mode === "frame";
  const slideMs = open ? OPEN_MS : CLOSE_MS;
  const frameTransition = (properties: string[]) =>
    properties
      .map((property) => `${property} ${reducedMotion ? 0 : slideMs}ms ease`)
      .join(", ");

  const cardStyle: CSSProperties = {
    // Ring via shadow (no 1px layout shift) + soft elevation; both states
    // keep the same two-layer list shape so the browser interpolates.
    borderRadius: framed ? 16 : 0,
    boxShadow: framed
      ? "0 0 0 1px var(--dtp-card-ring, var(--dtp-border)), 0 24px 64px -24px rgb(0 0 0 / 0.6)"
      : "0 0 0 0 var(--dtp-card-ring, var(--dtp-border)), 0 24px 64px -24px rgb(0 0 0 / 0)",
    height: framed ? `calc(100dvh - ${2 * FRAME_GAP}px)` : "100dvh",
    margin: framed
      ? `${FRAME_GAP}px ${FRAME_GAP + PANEL_W + FRAME_GAP}px ${FRAME_GAP}px ${FRAME_GAP}px`
      : "0px",
    transition: frameTransition([
      "margin",
      "height",
      "border-radius",
      "box-shadow",
    ]),
  };

  return (
    <div style={{ display: "contents", ...style }}>
      <div
        aria-hidden
        className="dtp-skin dtp-backdrop"
        style={{
          opacity: framed ? 1 : 0,
          transition: frameTransition(["opacity"]),
        }}
      />
      <div className="dtp-skin dtp-card" style={cardStyle}>
        {children}
      </div>
      <PanelAside
        key={mode}
        mode={mode}
        narrow={narrow}
        onModeToggle={() =>
          updatePrefs({ mode: prefs.mode === "frame" ? "float" : "frame" })
        }
        open={open}
        prefs={prefs}
        reducedMotion={reducedMotion}
        store={store}
        updatePrefs={updatePrefs}
      />
    </div>
  );
}

function modeToggleShort(mode: PanelMode): string {
  return mode === "frame" ? "Float" : "Dock";
}

interface PanelAsideProps {
  mode: PanelMode;
  narrow: boolean;
  onModeToggle: () => void;
  open: boolean;
  prefs: PanelPrefs;
  reducedMotion: boolean;
  store: DevTweaksStore;
  updatePrefs: (patch: Partial<PanelPrefs>) => void;
}

interface AsideGeometryInput {
  anchoredLeft: boolean;
  anchoredTop: boolean;
  /** Flips to true one frame after mount and stays — entrance detector. */
  entered: boolean;
  floatHeight: number | null;
  open: boolean;
  reducedMotion: boolean;
  /** open && entered — drives the entrance/exit transition target. */
  visible: boolean;
}

/** Frame mode: full-height 384px strip, full-width slide on the card timeline. */
function frameAsideStyle({
  open,
  reducedMotion,
  visible,
}: AsideGeometryInput): CSSProperties {
  const slideMs = open ? OPEN_MS : CLOSE_MS;
  return {
    bottom: FRAME_GAP,
    pointerEvents: open ? "auto" : "none",
    position: "fixed",
    right: FRAME_GAP,
    top: FRAME_GAP,
    transform: visible
      ? "translateX(0)"
      : `translateX(calc(100% + ${FRAME_GAP}px))`,
    transition: `transform ${reducedMotion ? 0 : slideMs}ms ease`,
    width: PANEL_W,
    zIndex: 60,
  };
}

/**
 * Float mode: 320px corner-snapped card. Open/close is a pure fade in place;
 * the 12px right-slide plays only on the entrance right after a mount (the
 * hard mode handoff), because `entered` flips once and stays true.
 */
function floatAsideStyle({
  anchoredLeft,
  anchoredTop,
  entered,
  floatHeight,
  open,
  reducedMotion,
  visible,
}: AsideGeometryInput): CSSProperties {
  return {
    height: floatHeight ?? "60dvh",
    maxHeight: `calc(100dvh - ${2 * FLOAT_MARGIN}px)`,
    minHeight: FLOAT_MIN_H,
    opacity: visible ? 1 : 0,
    pointerEvents: open ? "auto" : "none",
    position: "fixed",
    transform: entered ? "translateX(0)" : "translateX(12px)",
    transition: reducedMotion
      ? "none"
      : `opacity ${FLOAT_FADE_MS}ms ease, transform ${HANDOFF_MS}ms ease`,
    width: FLOAT_W,
    zIndex: 60,
    ...(anchoredLeft ? { left: FLOAT_MARGIN } : { right: FLOAT_MARGIN }),
    ...(anchoredTop ? { top: FLOAT_MARGIN } : { bottom: FLOAT_MARGIN }),
  };
}

function PanelAside({
  mode,
  narrow,
  onModeToggle,
  open,
  prefs,
  reducedMotion,
  store,
  updatePrefs,
}: PanelAsideProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Mount flag — lets the first open play an entrance transition even when
  // the aside just remounted (hard mode handoff).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(true);
  }, []);

  const anchoredTop = prefs.corner === "tl" || prefs.corner === "tr";
  const anchoredLeft = prefs.corner === "bl" || prefs.corner === "tl";
  const geometryInput: AsideGeometryInput = {
    anchoredLeft,
    anchoredTop,
    entered,
    floatHeight: prefs.floatHeight,
    open,
    reducedMotion,
    visible: open && entered,
  };
  const geometry =
    mode === "frame"
      ? frameAsideStyle(geometryInput)
      : floatAsideStyle(geometryInput);
  const modeToggleTitle = narrow
    ? "Docking needs a wider viewport"
    : modeToggleShort(mode);

  const headerDrag = useFloatDrag({
    enabled: mode === "float",
    panelRef,
    reducedMotion,
    setCorner: (corner) => updatePrefs({ corner }),
  });
  const resize = useFloatResize({
    anchoredTop,
    enabled: mode === "float",
    panelRef,
    setHeight: (floatHeight) => updatePrefs({ floatHeight }),
  });

  return (
    <aside
      aria-label="Dev tweaks"
      className="dtp-skin dtp-panel"
      data-mode={mode}
      inert={!open}
      ref={panelRef}
      style={geometry}
    >
      {mode === "float" ? (
        <div
          className="dtp-resize"
          style={anchoredTop ? { bottom: 0 } : { top: 0 }}
          {...resize}
        />
      ) : null}
      <header className="dtp-header" {...headerDrag}>
        <h2 className="dtp-title">Dev tweaks</h2>
        <button
          aria-label={
            mode === "frame" ? "Switch to floating window" : "Dock as frame"
          }
          className="dtp-iconbtn"
          disabled={narrow}
          onClick={onModeToggle}
          title={modeToggleTitle}
          type="button"
        >
          {mode === "frame" ? <IconFloat /> : <IconDock />}
        </button>
        <button
          aria-label="Close"
          className="dtp-iconbtn"
          onClick={() => store.setOpen(false)}
          title="Close (⌃⌥T)"
          type="button"
        >
          <IconClose />
        </button>
      </header>
      <PanelBody reducedMotion={reducedMotion} store={store} />
      <footer className="dtp-footer">
        <kbd className="dtp-kbd">⌃⌥T</kbd>
        <span>toggle</span>
        <ClearAllButton store={store} />
      </footer>
    </aside>
  );
}

function ClearAllButton({ store }: { store: DevTweaksStore }) {
  const active = useSyncExternalStore(
    store.subscribe,
    store.getActiveEntries,
    store.getActiveEntries
  );
  return (
    <button
      className="dtp-clearall"
      disabled={active.length === 0}
      onClick={() => store.clearAll()}
      type="button"
    >
      Clear all
    </button>
  );
}

function PanelBody({
  reducedMotion,
  store,
}: {
  reducedMotion: boolean;
  store: DevTweaksStore;
}) {
  const groups = useSyncExternalStore(
    store.subscribe,
    store.getGroups,
    store.getGroups
  );
  const active = useSyncExternalStore(
    store.subscribe,
    store.getActiveEntries,
    store.getActiveEntries
  );
  const focusCounter = useSyncExternalStore(
    store.subscribe,
    store.getFocusActiveCounter,
    store.getFocusActiveCounter
  );

  const activeSectionRef = useRef<HTMLElement | null>(null);
  const seenFocusRef = useRef(focusCounter);
  const [highlight, setHighlight] = useState(false);

  // Indicator click: land on the "Active" section and flash it briefly.
  useEffect(() => {
    if (focusCounter === seenFocusRef.current) {
      return;
    }
    seenFocusRef.current = focusCounter;
    activeSectionRef.current?.scrollIntoView?.({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [focusCounter, reducedMotion]);

  // "This screen": mock groups first, then tweaks; registration order within.
  const screenGroups = useMemo(
    () =>
      [...groups].sort(
        (a, b) =>
          Number(a.def.kind === "tweak") - Number(b.def.kind === "tweak")
      ),
    [groups]
  );

  return (
    <div className="dtp-body">
      {active.length > 0 ? (
        <CollapsibleSection
          count={active.length}
          highlight={highlight}
          sectionRef={activeSectionRef}
          title="Active"
        >
          {active.map((entry) => (
            <ActiveItem
              entry={entry}
              key={`${entry.groupKey}:${entry.controlKey}`}
              store={store}
            />
          ))}
        </CollapsibleSection>
      ) : null}
      <CollapsibleSection title="This screen">
        {screenGroups.length === 0 ? (
          <p className="dtp-empty">No controls registered on this screen.</p>
        ) : (
          screenGroups.map((group) => (
            <GroupSection group={group} key={group.key} store={store} />
          ))
        )}
      </CollapsibleSection>
    </div>
  );
}

interface CollapsibleSectionProps {
  children: ReactNode;
  count?: number;
  highlight?: boolean;
  sectionRef?: RefObject<HTMLElement | null>;
  title: string;
}

/** Section with a clickable hairline header; expanded by default, never persisted. */
function CollapsibleSection({
  children,
  count,
  highlight,
  sectionRef,
  title,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section
      className="dtp-section"
      data-highlight={highlight ? "true" : undefined}
      ref={sectionRef}
    >
      <div
        className="dtp-group"
        data-collapsed={collapsed ? "true" : undefined}
      >
        <h3 className="dtp-sectionhead">
          <button
            aria-expanded={!collapsed}
            className="dtp-sectiontoggle"
            onClick={() => setCollapsed((previous) => !previous)}
            type="button"
          >
            <span className="dtp-chevron">
              <IconChevron size={10} />
            </span>
            {title}
            {count === undefined ? null : (
              <span className="dtp-count">{count}</span>
            )}
          </button>
        </h3>
        <div className="dtp-groupbody">
          <div className="dtp-groupbody-inner">
            <div className="dtp-section dtp-sectionbody">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActiveItem({
  entry,
  store,
}: {
  entry: DevTweaksActiveEntry;
  store: DevTweaksStore;
}) {
  return (
    <div className="dtp-active-item">
      <div className="dtp-active-head">
        <span>
          {entry.groupDef.title} · {entry.groupDef.feature}
        </span>
        <button
          aria-label={`Remove ${entry.controlDef.label} override`}
          className="dtp-active-x"
          onClick={() => store.clearOverride(entry.groupKey, entry.controlKey)}
          type="button"
        >
          <IconClose size={11} />
        </button>
      </div>
      <ControlRow
        def={entry.controlDef}
        onChange={(value) =>
          store.setValue(entry.groupKey, entry.controlKey, value)
        }
        onReset={() => store.clearOverride(entry.groupKey, entry.controlKey)}
        overridden
        value={entry.value}
      />
    </div>
  );
}

function GroupSection({
  group,
  store,
}: {
  group: DevTweaksRegisteredGroup;
  store: DevTweaksStore;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const overrides = useSyncExternalStore(
    store.subscribe,
    () => store.getOverrides(group.key),
    () => store.getOverrides(group.key)
  );
  const dirty = Object.keys(overrides).length > 0;
  return (
    <div className="dtp-group" data-collapsed={collapsed ? "true" : undefined}>
      <div className="dtp-grouprow">
        <button
          aria-expanded={!collapsed}
          className="dtp-grouphead"
          onClick={() => setCollapsed((previous) => !previous)}
          title={group.def.note}
          type="button"
        >
          <span className="dtp-chevron">
            <IconChevron />
          </span>
          <span className="dtp-grouptitle">{group.def.title}</span>
          <span className="dtp-tag">{group.def.feature}</span>
          {group.def.kind === "mock" ? (
            <span className="dtp-mocktag">MOCK</span>
          ) : null}
        </button>
        {dirty ? (
          <button
            aria-label={`Reset ${group.def.title} to defaults`}
            className="dtp-reset"
            data-shown="true"
            onClick={() => store.clearGroup(group.key)}
            type="button"
          >
            <IconReset />
          </button>
        ) : null}
      </div>
      <div className="dtp-groupbody">
        <div className="dtp-groupbody-inner">
          <div className="dtp-groupbody-pad">
            {Object.entries(group.def.controls).map(([controlKey, def]) => {
              const override = overrides[controlKey] as
                | DevTweaksValue
                | undefined;
              return (
                <ControlRow
                  def={def}
                  key={controlKey}
                  onChange={(value) =>
                    store.setValue(group.key, controlKey, value)
                  }
                  onReset={() => store.clearOverride(group.key, controlKey)}
                  overridden={override !== undefined}
                  value={override ?? def.value}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Free drag on the float header; on release the panel flies to the nearest corner. */
function useFloatDrag({
  enabled,
  panelRef,
  reducedMotion,
  setCorner,
}: {
  enabled: boolean;
  panelRef: RefObject<HTMLElement | null>;
  reducedMotion: boolean;
  setCorner: (corner: PanelCorner) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  if (!enabled) {
    return {};
  }

  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest("button")) {
        return;
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = panelRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !el) {
        return;
      }
      el.style.transition = "none";
      el.style.transform = `translate(${event.clientX - drag.startX}px, ${event.clientY - drag.startY}px)`;
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = panelRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const nearest: PanelCorner = `${
        centerY < window.innerHeight / 2 ? "t" : "b"
      }${centerX < window.innerWidth / 2 ? "l" : "r"}` as PanelCorner;

      const targetLeft =
        nearest === "tl" || nearest === "bl"
          ? FLOAT_MARGIN
          : window.innerWidth - FLOAT_MARGIN - rect.width;
      const targetTop =
        nearest === "tl" || nearest === "tr"
          ? FLOAT_MARGIN
          : window.innerHeight - FLOAT_MARGIN - rect.height;
      const deltaX = rect.left - targetLeft;
      const deltaY = rect.top - targetTop;

      el.style.transform = "";
      el.style.transition = "";
      setCorner(nearest);
      if (!reducedMotion && (deltaX !== 0 || deltaY !== 0)) {
        const animation = el.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: "translate(0px, 0px)" },
          ],
          { duration: SNAP_MS, easing: "ease" }
        );
        // Background-tab fallback: make sure the fill can't wedge mid-flight.
        setTimeout(() => animation.cancel(), SNAP_MS + 100);
      }
    },
  };
}

/** Vertical resize from the float panel's free edge; height is persisted. */
function useFloatResize({
  anchoredTop,
  enabled,
  panelRef,
  setHeight,
}: {
  anchoredTop: boolean;
  enabled: boolean;
  panelRef: RefObject<HTMLElement | null>;
  setHeight: (height: number) => void;
}) {
  const resizeRef = useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);

  if (!enabled) {
    return {};
  }

  const clampHeight = (height: number) =>
    Math.min(
      Math.max(height, FLOAT_MIN_H),
      window.innerHeight - 2 * FLOAT_MARGIN
    );

  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      const el = panelRef.current;
      if (!el) {
        return;
      }
      resizeRef.current = {
        pointerId: event.pointerId,
        startHeight: el.getBoundingClientRect().height,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const resize = resizeRef.current;
      const el = panelRef.current;
      if (!resize || resize.pointerId !== event.pointerId || !el) {
        return;
      }
      const delta = event.clientY - resize.startY;
      const height = clampHeight(
        anchoredTop ? resize.startHeight + delta : resize.startHeight - delta
      );
      el.style.height = `${height}px`;
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const resize = resizeRef.current;
      const el = panelRef.current;
      if (!resize || resize.pointerId !== event.pointerId) {
        return;
      }
      resizeRef.current = null;
      if (!el) {
        return;
      }
      const height = el.getBoundingClientRect().height;
      el.style.height = "";
      setHeight(Math.round(height));
    },
  };
}
