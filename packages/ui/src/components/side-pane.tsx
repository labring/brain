"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { projectSurfaceMotionMs } from "@workspace/ui/lib/project-surface-motion";
import { cn } from "@workspace/ui/lib/utils";
import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const SidePaneMotionContext = createContext(true);

interface SidePaneFooterAttachment {
  host: HTMLElement | null;
  register: () => () => void;
}

const SidePaneFooterContext = createContext<SidePaneFooterAttachment | null>(
  null
);
type SidePaneGlowPhase = "enter" | "exit" | null;
const SidePaneGlowPhaseContext = createContext<SidePaneGlowPhase>(null);
const SIDE_PANE_GLOW_SETTLE_DURATION_VAR = "--side-pane-glow-settle-duration";
const SIDE_PANE_GLOW_SETTLE_FALLBACK_MS = 820;

function isRenderablePane(children: ReactNode): boolean {
  return children !== null && children !== undefined && children !== false;
}

function useSidePaneMotionOpen(open: boolean | undefined) {
  const contextOpen = useContext(SidePaneMotionContext);
  return open ?? contextOpen;
}

export type SidePaneWidth = "default" | "wide";

const sidePaneWidthClasses = {
  default: "max-w-screen-sm",
  wide: "max-w-screen-md",
} satisfies Record<SidePaneWidth, string>;

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
  /** Replaces the default title heading (e.g. an inline rename editor); `title` still labels the pane. */
  titleContent?: ReactNode;
  width?: SidePaneWidth;
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
  titleContent,
  width = "default",
}: SidePaneProps) {
  const motionOpen = useSidePaneMotionOpen(open);
  const glowPhase = useContext(SidePaneGlowPhaseContext);
  const [footerContributors, setFooterContributors] = useState(0);
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
  // The same node, held in a ref: the footer's lift flag is written straight to
  // the DOM, and only a ref may be mutated outside render.
  const footerHostRef = useRef<HTMLDivElement | null>(null);
  const attachFooterHost = useCallback((node: HTMLDivElement | null) => {
    footerHostRef.current = node;
    setFooterHost(node);
  }, []);
  const registerFooter = useCallback(() => {
    setFooterContributors((count) => count + 1);
    return () => setFooterContributors((count) => Math.max(0, count - 1));
  }, []);
  const footerAttachment = useMemo<SidePaneFooterAttachment>(
    () => ({ host: footerHost, register: registerFooter }),
    [footerHost, registerFooter]
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Footer lift: the cast shadow appears only while content still sits below
  // the fold, so a pane whose content fits — or that is scrolled to the end —
  // shows no separator at all. State is written straight to the DOM because
  // scroll ticks must never repaint the pane shell (the timeline's
  // header-freeze design depends on that).
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (footerHost == null || scrollEl == null) {
      return;
    }
    const sync = () => {
      const scrolledToEnd =
        scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
      const hostEl = footerHostRef.current;
      if (hostEl != null) {
        hostEl.dataset.lifted = String(!scrolledToEnd);
      }
    };
    sync();
    scrollEl.addEventListener("scroll", sync, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(scrollEl);
    const scrollContent = scrollEl.firstElementChild;
    if (scrollContent != null) {
      observer?.observe(scrollContent);
    }
    return () => {
      scrollEl.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, [footerHost]);

  return (
    <aside
      aria-busy={busy || undefined}
      aria-hidden={!motionOpen}
      aria-label={label}
      className={cn(
        "project-surface-slide-x pointer-events-auto absolute top-[calc(3.25rem-1px)] right-0 bottom-0 z-20 w-full min-w-0 overflow-hidden transition-[opacity,transform] ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
        sidePaneWidthClasses[width],
        motionOpen
          ? "project-surface-slide-x-open opacity-100 duration-[var(--project-surface-motion-enter-duration)]"
          : "project-surface-slide-x-offset pointer-events-none opacity-0 duration-[var(--project-surface-motion-exit-duration)]"
      )}
      data-slot="side-pane"
      data-state={motionOpen ? "open" : "closed"}
    >
      <div
        className={cn(
          "project-chrome-surface project-surface-slide-x dark absolute inset-y-0 right-0 flex w-screen min-w-0 flex-col overflow-hidden rounded-tl-lg border-border border-t border-l text-foreground shadow-lg transition-transform ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
          sidePaneWidthClasses[width],
          motionOpen
            ? "project-surface-slide-x-open duration-[var(--project-surface-motion-enter-duration)]"
            : "project-surface-slide-x-full duration-[var(--project-surface-motion-exit-duration)]",
          className
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col gap-2.5">
          <header
            className={cn(
              "flex shrink-0 items-center gap-3 px-4 pt-4",
              headerClassName
            )}
          >
            {icon == null ? null : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-input/30">
                {icon}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-h-7 min-w-0 items-center gap-2">
                {titleContent ?? (
                  <h2
                    className="truncate font-semibold text-base text-foreground leading-none"
                    title={title}
                  >
                    {title}
                  </h2>
                )}
              </div>
              {subtitle == null || subtitle.trim() === "" ? null : (
                <p className="truncate text-muted-foreground text-xs leading-4">
                  {subtitle}
                </p>
              )}
            </div>
            <AppIconButton
              aria-label={closeAriaLabel}
              className="shrink-0 self-start"
              onClick={onClose}
              size="md"
              type="button"
              variant="quiet"
            >
              <X aria-hidden className="size-4" />
            </AppIconButton>
          </header>
          <div
            className="scrollbar-chat-thin min-h-0 flex-1 overflow-y-auto"
            ref={scrollRef}
          >
            <div
              className={cn(
                "flex min-h-full min-w-0 flex-col gap-5 px-4 pt-1.5 pb-4",
                bodyClassName
              )}
            >
              <SidePaneFooterContext.Provider value={footerAttachment}>
                {children}
              </SidePaneFooterContext.Provider>
            </div>
          </div>
        </div>
        {footerContributors > 0 ? (
          <div
            className="side-pane-footer-lift flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2.5 px-4 py-3"
            data-slot="side-pane-footer"
            ref={attachFooterHost}
          />
        ) : null}
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

/**
 * Side Pane Footer slot: mounts its children into the pane's pinned footer
 * region from any depth of pane content. Presence is registered on mount, so
 * a pane with no contributor renders no footer region and no border; content
 * itself travels through a portal, so contributor re-renders (e.g. timeline
 * stream ticks) never repaint the pane shell. Outside a Side Pane the slot
 * renders its children in place, keeping chrome-less hosts functional.
 */
export function SidePaneFooter({ children }: { children: ReactNode }) {
  const attachment = useContext(SidePaneFooterContext);

  useEffect(() => {
    if (attachment == null) {
      return;
    }
    return attachment.register();
  }, [attachment]);

  if (attachment == null) {
    return <>{children}</>;
  }
  if (attachment.host == null) {
    return null;
  }
  return createPortal(children, attachment.host);
}

export function SidePanePresence({ children }: { children: ReactNode }) {
  const hasChildren = isRenderablePane(children);

  // Mirror of the latest renderable children; keeps painting them through the
  // exit transition after the caller clears the pane.
  const [lastChildren, setLastChildren] = useState<ReactNode>(
    hasChildren ? children : null
  );
  // Drives the open transforms: false paints the closed position, and the
  // opening effect flips it true a frame later so the slide can transition.
  const [slideIn, setSlideIn] = useState(hasChildren);
  const [glowPhase, setGlowPhase] = useState<SidePaneGlowPhase>(null);
  // True once the close transition has finished and the pane may unmount.
  const [exited, setExited] = useState(!hasChildren);
  const [prevPresent, setPrevPresent] = useState(hasChildren);

  if (hasChildren && children !== lastChildren) {
    setLastChildren(children);
  }

  // Presence transitions adjust state during render so the first frame of an
  // open already paints the closed transform and the first frame of a close
  // already paints the exit; effects below only run the timer choreography.
  if (prevPresent !== hasChildren) {
    setPrevPresent(hasChildren);
    if (hasChildren) {
      setExited(false);
      setSlideIn(false);
      setGlowPhase(null);
    } else {
      setGlowPhase("exit");
    }
  }

  const presentRef = useRef(hasChildren);
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

    if (isRenderablePane(children)) {
      const wasPresent = presentRef.current;
      presentRef.current = true;
      clearCloseTimer();

      if (wasPresent) {
        return;
      }

      clearGlowTimer();
      clearOpenFrame();
      // Let the closed transform paint before opening; otherwise light pages can
      // batch both states into a jump instead of a transition.
      openFrameRef.current = requestAnimationFrame(() => {
        openFrameRef.current = requestAnimationFrame(() => {
          openFrameRef.current = null;
          setSlideIn(true);
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
    glowTimerRef.current = setTimeout(() => {
      glowTimerRef.current = null;
      setGlowPhase(null);
    }, closeMs);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setLastChildren(null);
      setExited(true);
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

  const renderedChildren = hasChildren ? children : lastChildren;

  if (exited || !isRenderablePane(renderedChildren)) {
    return null;
  }

  return (
    <SidePaneMotionContext.Provider value={hasChildren && slideIn}>
      <SidePaneGlowPhaseContext.Provider value={glowPhase}>
        {renderedChildren}
      </SidePaneGlowPhaseContext.Provider>
    </SidePaneMotionContext.Provider>
  );
}
