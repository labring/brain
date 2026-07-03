"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { projectSurfaceMotionMs } from "@workspace/ui/lib/project-surface-motion";
import { cn } from "@workspace/ui/lib/utils";
import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const SidePaneMotionContext = createContext(true);
type SidePaneGlowPhase = "enter" | "exit" | null;
const SidePaneGlowPhaseContext = createContext<SidePaneGlowPhase>(null);
const SIDE_PANE_GLOW_SETTLE_DURATION_VAR = "--side-pane-glow-settle-duration";
const SIDE_PANE_GLOW_SETTLE_FALLBACK_MS = 620;

function isRenderablePane(children: ReactNode): boolean {
  return children !== null && children !== undefined && children !== false;
}

function useSidePaneMotionOpen(open: boolean | undefined) {
  const contextOpen = useContext(SidePaneMotionContext);
  return open ?? contextOpen;
}

export interface SidePaneProps {
  bodyClassName?: string;
  busy?: boolean;
  children: ReactNode;
  className?: string;
  closeAriaLabel?: string;
  headerClassName?: string;
  icon?: ReactNode;
  label?: string;
  onClose: () => void;
  open?: boolean;
  subtitle?: string;
  title: string;
}

export function SidePane({
  bodyClassName,
  children,
  className,
  closeAriaLabel = "Close side pane",
  headerClassName,
  icon,
  label,
  onClose,
  open,
  busy,
  subtitle,
  title,
}: SidePaneProps) {
  const motionOpen = useSidePaneMotionOpen(open);
  const glowPhase = useContext(SidePaneGlowPhaseContext);

  return (
    <aside
      aria-busy={busy || undefined}
      aria-hidden={!motionOpen}
      aria-label={label}
      className={cn(
        "project-surface-slide-x pointer-events-auto absolute top-13 right-0 bottom-0 z-20 w-full min-w-0 max-w-screen-sm overflow-hidden transition-[opacity,transform] ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
        motionOpen
          ? "project-surface-slide-x-open opacity-100 duration-[var(--project-surface-motion-enter-duration)]"
          : "project-surface-slide-x-offset pointer-events-none opacity-0 duration-[var(--project-surface-motion-exit-duration)]"
      )}
      data-slot="side-pane"
    >
      <div
        className={cn(
          "project-chrome-surface project-surface-slide-x dark absolute inset-y-0 right-0 flex w-screen min-w-0 max-w-screen-sm flex-col overflow-hidden rounded-tl-lg border-input border-t border-l text-foreground shadow-lg transition-transform ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
          motionOpen
            ? "project-surface-slide-x-open duration-[var(--project-surface-motion-enter-duration)]"
            : "project-surface-slide-x-full duration-[var(--project-surface-motion-exit-duration)]",
          className
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col gap-2.5">
          <header
            className={cn(
              "flex shrink-0 items-start gap-3 px-5 pt-5 pr-18",
              headerClassName
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex min-w-0 items-center gap-2">
                {icon == null ? null : (
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {icon}
                  </span>
                )}
                <h2
                  className="truncate font-semibold text-foreground text-lg leading-none"
                  title={title}
                >
                  {title}
                </h2>
              </div>
              {subtitle == null || subtitle.trim() === "" ? null : (
                <p className="truncate text-muted-foreground text-sm leading-5">
                  {subtitle}
                </p>
              )}
            </div>
            <AppIconButton
              aria-label={closeAriaLabel}
              className="absolute top-3 right-5 shrink-0"
              onClick={onClose}
              size="lg"
              type="button"
              variant="quiet"
            >
              <X aria-hidden className="size-4" />
            </AppIconButton>
          </header>
          <div className="scrollbar-chat-thin min-h-0 flex-1 overflow-y-auto">
            <div
              className={cn(
                "flex min-h-full min-w-0 flex-col gap-5 px-5 pt-2.5 pb-5",
                bodyClassName
              )}
            >
              {children}
            </div>
          </div>
        </div>
        <div
          aria-hidden
          className={cn(
            "side-pane-glow motion-reduce:animate-none",
            glowPhase === "enter" && "side-pane-glow-settle",
            glowPhase === "exit" && "side-pane-glow-release"
          )}
          data-slot="side-pane-glow"
        />
      </div>
    </aside>
  );
}

export function SidePanePresence({ children }: { children: ReactNode }) {
  const initialChildren = isRenderablePane(children) ? children : null;
  const [renderedChildren, setRenderedChildren] =
    useState<ReactNode>(initialChildren);
  const [open, setOpen] = useState(initialChildren !== null);
  const [glowPhase, setGlowPhase] = useState<SidePaneGlowPhase>(null);
  const presentRef = useRef(initialChildren !== null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearCloseTimer = () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
    const clearOpenFrame = () => {
      if (openFrameRef.current !== null) {
        cancelAnimationFrame(openFrameRef.current);
        openFrameRef.current = null;
      }
    };
    const clearGlowTimer = () => {
      if (glowTimerRef.current !== null) {
        clearTimeout(glowTimerRef.current);
        glowTimerRef.current = null;
      }
    };
    const hasChildren = isRenderablePane(children);

    if (hasChildren) {
      const wasPresent = presentRef.current;
      const opening = openFrameRef.current !== null;
      presentRef.current = true;
      clearCloseTimer();
      clearGlowTimer();
      setRenderedChildren(children);

      if (wasPresent) {
        if (opening) {
          return;
        }
        setOpen(true);
        setGlowPhase(null);
        return;
      }

      clearOpenFrame();
      setOpen(false);
      setGlowPhase(null);
      // Let the closed transform paint before opening; otherwise light pages can
      // batch both states into a jump instead of a transition.
      openFrameRef.current = requestAnimationFrame(() => {
        openFrameRef.current = requestAnimationFrame(() => {
          openFrameRef.current = null;
          setOpen(true);
          setGlowPhase("enter");
          glowTimerRef.current = setTimeout(
            () => {
              glowTimerRef.current = null;
              setGlowPhase(null);
            },
            projectSurfaceMotionMs(
              SIDE_PANE_GLOW_SETTLE_DURATION_VAR,
              SIDE_PANE_GLOW_SETTLE_FALLBACK_MS
            )
          );
        });
      });
      return;
    }

    if (!presentRef.current) {
      return;
    }

    presentRef.current = false;
    clearOpenFrame();
    clearGlowTimer();
    const closeMs = projectSurfaceMotionMs();
    setOpen(false);
    setGlowPhase("exit");
    glowTimerRef.current = setTimeout(() => {
      glowTimerRef.current = null;
      setGlowPhase(null);
    }, closeMs);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setRenderedChildren(null);
    }, closeMs);
  }, [children]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
      if (openFrameRef.current !== null) {
        cancelAnimationFrame(openFrameRef.current);
      }
      if (glowTimerRef.current !== null) {
        clearTimeout(glowTimerRef.current);
      }
    },
    []
  );

  if (!isRenderablePane(renderedChildren)) {
    return null;
  }

  return (
    <SidePaneMotionContext.Provider value={open}>
      <SidePaneGlowPhaseContext.Provider value={glowPhase}>
        {renderedChildren}
      </SidePaneGlowPhaseContext.Provider>
    </SidePaneMotionContext.Provider>
  );
}
