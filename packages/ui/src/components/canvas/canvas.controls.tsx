"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { MiniMap, useReactFlow } from "@xyflow/react";
import { Fullscreen, Hand, Minus, MousePointer2, Plus } from "lucide-react";
import type { FocusEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CanvasInteractionMode } from "./canvas.types";
import { useCanvas } from "./canvas.use";

const VIEWPORT_ACTION_DURATION_MS = 180;
type CanvasShortcut = "fit-view" | "hand" | "pointer" | "zoom-in" | "zoom-out";

export interface CanvasViewportInsetProps {
  rightInset?: number;
}

export interface CanvasControlsProps extends CanvasViewportInsetProps {
  className?: string;
}

export interface CanvasMiniMapProps extends CanvasViewportInsetProps {
  className?: string;
}

interface CanvasControlButtonProps {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}

function useCanvasNavigationChromePresence() {
  const {
    navigationChrome: { beginInteraction, endInteraction, reveal, visible },
  } = useCanvas();
  const holdingRef = useRef(false);

  const beginHold = useCallback(() => {
    if (holdingRef.current) {
      return;
    }
    holdingRef.current = true;
    beginInteraction();
  }, [beginInteraction]);

  const endHold = useCallback(() => {
    if (!holdingRef.current) {
      return;
    }
    holdingRef.current = false;
    endInteraction();
  }, [endInteraction]);

  useEffect(
    () => () => {
      endHold();
    },
    [endHold]
  );

  const interactionProps = useMemo(
    () => ({
      onBlurCapture: (event: FocusEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return;
        }
        endHold();
      },
      onFocusCapture: beginHold,
      onPointerEnter: beginHold,
      onPointerLeave: endHold,
    }),
    [beginHold, endHold]
  );

  return {
    hidden: !visible,
    interactionProps,
    reveal,
  };
}

function runViewportAction(action: () => Promise<boolean>) {
  action().catch(() => undefined);
}

function resolveCanvasShortcut(event: KeyboardEvent): CanvasShortcut | null {
  const key = event.key.toLowerCase();

  if (key === "v") {
    return "pointer";
  }
  if (key === "h") {
    return "hand";
  }
  if (key === "0") {
    return "fit-view";
  }
  if (event.key === "+" || event.key === "=") {
    return "zoom-in";
  }
  if (event.key === "-" || event.key === "_") {
    return "zoom-out";
  }

  return null;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    target.closest(
      '[contenteditable="true"], [data-canvas-hotkeys="ignore"]'
    ) !== null
  );
}

function isCanvasKeyboardScope(
  target: EventTarget | null,
  root: HTMLElement | null
): boolean {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (root === null) {
    return false;
  }

  if (!root.contains(target)) {
    return false;
  }

  return (
    target.closest(
      [
        '[data-slot="project-assistant-pane"]',
        '[data-slot="chat"]',
        '[data-slot="chat-composer-focus-scope"]',
        '[data-slot="exec-terminal-plane"]',
        '[data-slot="main-action-surface"]',
        '[data-slot="settings-host-sections"]',
        '[data-slot="side-pane"]',
        '[aria-label="Terminal session"]',
        ".xterm",
      ].join(", ")
    ) === null
  );
}

function CanvasControlButton({
  active = false,
  children,
  label,
  onClick,
}: CanvasControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppIconButton
            aria-label={label}
            aria-pressed={active || undefined}
            className={cn(
              "text-muted-foreground hover:bg-input/30 hover:text-foreground data-[active=true]:bg-input data-[active=true]:text-brand-primary-foreground"
            )}
            data-active={active || undefined}
            onClick={onClick}
            size="lg"
            type="button"
            variant="quiet"
          >
            {children}
          </AppIconButton>
        }
      />
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CanvasControls({ className, rightInset }: CanvasControlsProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { interactionMode, rootRef, setInteractionMode } = useCanvas();
  const chrome = useCanvasNavigationChromePresence();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableKeyboardTarget(event.target) ||
        !isCanvasKeyboardScope(event.target, rootRef.current)
      ) {
        return;
      }

      const shortcut = resolveCanvasShortcut(event);
      if (shortcut === null) {
        return;
      }

      event.preventDefault();
      chrome.reveal();
      if (shortcut === "pointer" || shortcut === "hand") {
        setInteractionMode(shortcut);
        return;
      }
      if (shortcut === "fit-view") {
        runViewportAction(() =>
          fitView({ duration: VIEWPORT_ACTION_DURATION_MS })
        );
        return;
      }
      if (shortcut === "zoom-in") {
        runViewportAction(() =>
          zoomIn({ duration: VIEWPORT_ACTION_DURATION_MS })
        );
        return;
      }
      runViewportAction(() =>
        zoomOut({ duration: VIEWPORT_ACTION_DURATION_MS })
      );
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [chrome.reveal, fitView, rootRef, setInteractionMode, zoomIn, zoomOut]);

  const modeButton = (mode: CanvasInteractionMode, label: string) => ({
    active: interactionMode === mode,
    label,
    onClick: () => {
      chrome.reveal();
      setInteractionMode(mode);
    },
  });
  const rightOffset =
    rightInset === undefined
      ? "calc(0.5rem + var(--canvas-viewport-right-inset, 0px))"
      : `calc(0.5rem + ${Math.max(0, rightInset)}px)`;

  return (
    <div
      className={cn(
        "absolute top-[52px] right-2 z-10 flex flex-col items-center rounded-lg transition-[right,opacity] duration-200 ease-out",
        chrome.hidden
          ? "pointer-events-none opacity-0"
          : "pointer-events-auto opacity-100",
        className
      )}
      data-slot="canvas-controls"
      data-visible={chrome.hidden ? undefined : "true"}
      {...chrome.interactionProps}
      style={{ right: rightOffset }}
    >
      <CanvasControlButton {...modeButton("hand", "Hand tool")}>
        <Hand aria-hidden className="size-4" />
      </CanvasControlButton>
      <CanvasControlButton {...modeButton("pointer", "Pointer tool")}>
        <MousePointer2 aria-hidden className="size-4" />
      </CanvasControlButton>
      <CanvasControlButton
        label="Fit view"
        onClick={() => {
          chrome.reveal();
          runViewportAction(() =>
            fitView({ duration: VIEWPORT_ACTION_DURATION_MS })
          );
        }}
      >
        <Fullscreen aria-hidden className="size-4" />
      </CanvasControlButton>
      <CanvasControlButton
        label="Zoom in"
        onClick={() => {
          chrome.reveal();
          runViewportAction(() =>
            zoomIn({ duration: VIEWPORT_ACTION_DURATION_MS })
          );
        }}
      >
        <Plus aria-hidden className="size-4" />
      </CanvasControlButton>
      <CanvasControlButton
        label="Zoom out"
        onClick={() => {
          chrome.reveal();
          runViewportAction(() =>
            zoomOut({ duration: VIEWPORT_ACTION_DURATION_MS })
          );
        }}
      >
        <Minus aria-hidden className="size-4" />
      </CanvasControlButton>
    </div>
  );
}

export function CanvasMiniMap({
  className,
  rightInset = 0,
}: CanvasMiniMapProps) {
  const chrome = useCanvasNavigationChromePresence();

  return (
    <div
      className={cn(
        "absolute top-[60px] left-3 z-10 transition-[right,opacity] duration-200 ease-out",
        chrome.hidden
          ? "pointer-events-none opacity-0"
          : "pointer-events-auto opacity-100",
        className
      )}
      data-slot="canvas-minimap"
      data-visible={chrome.hidden ? undefined : "true"}
      {...chrome.interactionProps}
      style={{ right: rightInset > 0 ? `${rightInset}px` : undefined }}
    >
      <MiniMap
        ariaLabel="Canvas mini map"
        bgColor="color-mix(in oklab, var(--input) 30%, transparent)"
        className="overflow-hidden bg-input/30 shadow-none"
        maskColor="color-mix(in oklab, var(--input) 30%, transparent)"
        maskStrokeColor="var(--color-border)"
        maskStrokeWidth={1}
        nodeBorderRadius={10}
        nodeColor="color-mix(in oklab, #09090b 80%, transparent)"
        nodeStrokeColor="transparent"
        nodeStrokeWidth={0}
        pannable
        position="top-left"
        style={{
          height: 130,
          margin: 0,
          width: 223,
        }}
        zoomable
      />
    </div>
  );
}
