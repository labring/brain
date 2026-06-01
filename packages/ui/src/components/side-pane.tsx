"use client";

import { Button } from "@workspace/ui/components/button";
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

export const SIDE_PANE_TRANSITION_MS = 200;

const SidePaneMotionContext = createContext(true);

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

  return (
    <aside
      aria-busy={busy || undefined}
      aria-hidden={!motionOpen}
      aria-label={label}
      className={cn(
        "pointer-events-auto absolute top-13 right-0 bottom-0 z-20 min-w-0 overflow-hidden transition-[width,max-width,min-width,opacity,transform] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none",
        motionOpen
          ? "w-full max-w-screen-sm translate-x-0 opacity-100"
          : "pointer-events-none w-0 max-w-0 translate-x-4 opacity-0"
      )}
    >
      <div
        className={cn(
          "resource-pane-surface dark absolute inset-y-0 right-0 flex w-screen min-w-0 max-w-screen-sm flex-col overflow-hidden rounded-tl-lg border-input border-t border-l text-foreground shadow-lg transition-transform duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none",
          motionOpen ? "translate-x-0" : "translate-x-full",
          className
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <header
            className={cn(
              "flex shrink-0 items-start justify-between gap-3 px-5 pt-5",
              headerClassName
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex min-w-0 items-center gap-2.5">
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
            <Button
              aria-label={closeAriaLabel}
              className="hoverable -mt-1 size-7 shrink-0"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden className="size-3.5" />
            </Button>
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
      </div>
    </aside>
  );
}

export function SidePanePresence({ children }: { children: ReactNode }) {
  const initialChildren = isRenderablePane(children) ? children : null;
  const [renderedChildren, setRenderedChildren] =
    useState<ReactNode>(initialChildren);
  const [open, setOpen] = useState(false);
  const presentRef = useRef(isRenderablePane(children));
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openFrameRef = useRef<number | null>(null);

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
    const hasChildren = isRenderablePane(children);

    if (hasChildren) {
      const wasPresent = presentRef.current;
      presentRef.current = true;
      clearCloseTimer();
      clearOpenFrame();
      setRenderedChildren(children);

      if (wasPresent) {
        setOpen(true);
        return;
      }

      setOpen(false);
      openFrameRef.current = requestAnimationFrame(() => {
        openFrameRef.current = null;
        setOpen(true);
      });
      return;
    }

    if (!presentRef.current) {
      return;
    }

    presentRef.current = false;
    clearOpenFrame();
    setOpen(false);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setRenderedChildren(null);
    }, SIDE_PANE_TRANSITION_MS);
  }, [children]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
      if (openFrameRef.current !== null) {
        cancelAnimationFrame(openFrameRef.current);
      }
    },
    []
  );

  if (!isRenderablePane(renderedChildren)) {
    return null;
  }

  return (
    <SidePaneMotionContext.Provider value={open}>
      {renderedChildren}
    </SidePaneMotionContext.Provider>
  );
}
