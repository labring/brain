import { Sidebar } from "@data-browser/components/sidebar/Sidebar";
import { useDbAccessTabs } from "@data-browser/state/db-access-session";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceTabBar } from "./ServiceTabBar";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256;

export function MainLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const { activeSurface } = useDbAccessTabs();
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) {
        return;
      }
      const newWidth = e.clientX;
      setSidebarWidth(
        Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, newWidth))
      );
    };

    const handleMouseUp = () => {
      if (!isResizing.current) {
        return;
      }
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
          <div
            className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
            data-qa-action="resize"
            data-qa-module="layout"
            data-qa-object="sidebar"
            data-testid="layout.sidebar-resize-handle"
            onMouseDown={handleMouseDown}
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
