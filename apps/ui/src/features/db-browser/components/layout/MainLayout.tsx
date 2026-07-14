import { usePointerResizeGesture } from "@db-browser/components/shared/usePointerResizeGesture";
import { Sidebar } from "@db-browser/components/sidebar/Sidebar";
import { useDbAccessTabs } from "@db-browser/state/db-access-session";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { useCallback, useRef, useState } from "react";
import { ServiceTabBar } from "./ServiceTabBar";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256;

interface SidebarResizeOrigin {
  startWidth: number;
  startX: number;
}

export function sidebarWidthDuringResize(
  origin: SidebarResizeOrigin,
  clientX: number
) {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, origin.startWidth + (clientX - origin.startX))
  );
}

export function MainLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const { activeSurface } = useDbAccessTabs();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pointerResize = usePointerResizeGesture();

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const sidebar = sidebarRef.current;
      if (!sidebar) {
        return;
      }

      const origin = {
        startWidth: sidebar.getBoundingClientRect().width,
        startX: event.clientX,
      } satisfies SidebarResizeOrigin;
      pointerResize.start(event, {
        cancel: () => {
          sidebar.style.width = `${sidebarWidth}px`;
        },
        commit: (clientX) => {
          setSidebarWidth(sidebarWidthDuringResize(origin, clientX));
        },
        preview: (clientX) => {
          sidebar.style.width = `${sidebarWidthDuringResize(origin, clientX)}px`;
        },
      });
    },
    [pointerResize, sidebarWidth]
  );

  return (
    <TooltipProvider>
      <div
        className="flex h-full min-h-0 w-full overflow-hidden"
        data-qa-module="layout"
        data-qa-object="app-shell"
        data-qa-state="db-access-session"
        data-testid="layout.shell"
      >
        <div
          className="relative shrink-0"
          data-qa-module="layout"
          data-qa-object="sidebar"
          data-qa-state="db-access-session"
          data-testid="layout.sidebar-region"
          ref={sidebarRef}
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
          <div
            className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
            data-qa-action="resize"
            data-qa-module="layout"
            data-qa-object="sidebar"
            data-testid="layout.sidebar-resize-handle"
            onLostPointerCapture={pointerResize.cancel}
            onPointerCancel={pointerResize.cancel}
            onPointerDown={handlePointerDown}
            onPointerMove={pointerResize.move}
            onPointerUp={pointerResize.finish}
          />
        </div>

        <main
          className="relative flex flex-1 flex-col overflow-hidden"
          data-qa-module="layout"
          data-qa-object="main"
          data-qa-state="db-access-session"
          data-testid="layout.main-region"
        >
          {activeSurface.kind === "service" ? <ServiceTabBar /> : <TabBar />}
          <TabContent />
        </main>
      </div>
    </TooltipProvider>
  );
}
