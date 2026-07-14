import { PointerContextMenu } from "@db-browser/components/shared/PointerContextMenu";
import {
  type DbAccessTab,
  type DbAccessTabType,
  useDbAccessTabs,
} from "@db-browser/state/db-access-session";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  ChevronsRight,
  Database,
  KeyRound,
  SplitSquareHorizontal,
  Table,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const activeMenuItemClassName =
  "bg-input focus:bg-input data-highlighted:bg-input";

function getTabIcon(type: DbAccessTabType, isActive: boolean) {
  const iconClassName = cn("h-4 w-4", isActive && "text-blue-400");

  switch (type) {
    case "table":
      return <Table className={iconClassName} />;
    case "collection":
      return <Database className={iconClassName} />;
    case "redis_key_detail":
      return <KeyRound className={iconClassName} />;
    default:
      return <Database className={iconClassName} />;
  }
}

interface TabItemProps {
  closeTitle: string;
  isActive: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  tab: DbAccessTab;
  tabRef: (element: HTMLDivElement | null) => void;
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
  closeTitle,
  tabRef,
}: TabItemProps) {
  return (
    <div
      className={cn(
        "group flex h-9 cursor-pointer select-none items-center gap-2 border-sidebar-border border-r bg-clip-padding p-2 transition-colors duration-150",
        isActive ? "bg-input text-foreground" : "text-foreground hover:bg-input"
      )}
      data-qa-action="activate"
      data-qa-database={tab.databaseName}
      data-qa-db-service-key={tab.dbServiceKey}
      data-qa-module="layout"
      data-qa-object="tab"
      data-qa-resource-id={tab.id}
      data-qa-resource-type="tab"
      data-qa-schema={tab.schemaName}
      data-qa-state={[
        isActive ? "active" : "inactive",
        tab.isDirty ? "dirty" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      data-qa-tab-type={tab.type}
      data-testid="layout.tab.item"
      onClick={onActivate}
      onContextMenu={onContextMenu}
      ref={tabRef}
    >
      <span className="flex-shrink-0">{getTabIcon(tab.type, isActive)}</span>
      <span className="truncate whitespace-nowrap font-normal text-sm">
        {tab.title}
        {tab.isDirty && <span className="ml-1 text-primary">•</span>}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <AppIconButton
              aria-label={closeTitle}
              className={cn(
                "flex-shrink-0 cursor-pointer text-muted-foreground transition-colors",
                isActive ? "hover:bg-muted-foreground/20" : "hover:bg-input"
              )}
              data-qa-action="close"
              data-qa-module="layout"
              data-qa-object="tab"
              data-qa-resource-id={tab.id}
              data-qa-resource-type="tab"
              data-testid="layout.tab.close-button"
              onClick={onClose}
              size="sm"
              variant="quiet"
            >
              <X className="h-4 w-4" />
            </AppIconButton>
          }
        />
        <TooltipContent>{closeTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function getScrollViewport(container: HTMLElement | null) {
  return container?.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]'
  );
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
  } = useDbAccessTabs();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabElementsRef = useRef(new Map<string, HTMLDivElement>());
  const hasTabs = tabs.length > 0;

  const scrollTabIntoView = useCallback((tabId: string) => {
    tabElementsRef.current
      .get(tabId)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);

  useEffect(() => {
    const viewport = getScrollViewport(containerRef.current);
    if (!(hasTabs && viewport) || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateOverflow = () => {
      setIsOverflowing(viewport.scrollWidth > viewport.clientWidth);
    };
    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    if (viewport.firstElementChild) {
      observer.observe(viewport.firstElementChild);
    }
    return () => observer.disconnect();
  }, [hasTabs, tabs.length]);

  useEffect(() => {
    const viewport = getScrollViewport(containerRef.current);
    if (!(hasTabs && viewport)) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      if (
        e.deltaY === 0 ||
        e.shiftKey ||
        viewport.scrollWidth <= viewport.clientWidth
      ) {
        return;
      }
      viewport.scrollLeft += e.deltaY;
      e.preventDefault();
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [hasTabs]);

  useEffect(() => {
    if (activeTabId) {
      scrollTabIntoView(activeTabId);
    }
  }, [activeTabId, scrollTabIntoView]);

  if (!hasTabs) {
    return null;
  }

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const handleMenuAction = (action: "close" | "closeOthers" | "closeAll") => {
    if (!contextMenu) {
      return;
    }

    switch (action) {
      case "close":
        closeTab(contextMenu.tabId);
        break;
      case "closeOthers":
        closeOtherTabs(contextMenu.tabId);
        break;
      case "closeAll":
        closeAllTabs();
        break;
    }
    setContextMenu(null);
  };

  const handleOverflowSelect = (tabId: string) => {
    setActiveTab(tabId);
    scrollTabIntoView(tabId);
  };

  return (
    <div
      className="mb-2 flex items-center border-sidebar-border border-b"
      data-qa-module="layout"
      data-qa-object="tab-bar"
      data-qa-state={isOverflowing ? "ready overflowing" : "ready"}
      data-testid="layout.tab-bar"
      ref={containerRef}
    >
      <ScrollArea className="min-w-0 flex-1">
        <div className="flex items-center pr-2">
          {tabs.map((tab) => (
            <TabItem
              closeTitle={"Close tab"}
              isActive={tab.id === activeTabId}
              key={tab.id}
              onActivate={() => setActiveTab(tab.id)}
              onClose={(e) => handleClose(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              tab={tab}
              tabRef={(element) => {
                if (element) {
                  tabElementsRef.current.set(tab.id, element);
                } else {
                  tabElementsRef.current.delete(tab.id);
                }
              }}
            />
          ))}
        </div>
      </ScrollArea>

      {isOverflowing && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <AppIconButton
                      aria-label={"All tabs"}
                      className="shrink-0 rounded-none border-y-0 border-r-0 border-l-sidebar-border hover:bg-input data-popup-open:bg-input"
                      data-qa-action="open"
                      data-qa-module="layout"
                      data-qa-object="tab-overflow"
                      data-testid="layout.tab-bar.overflow-trigger"
                      size="lg"
                      variant="quiet"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </AppIconButton>
                  }
                />
              }
            />
            <TooltipContent>{"All tabs"}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto max-w-72">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <DropdownMenuItem
                  className={cn(isActive && activeMenuItemClassName)}
                  data-qa-action="activate"
                  data-qa-module="layout"
                  data-qa-object="tab-overflow-item"
                  data-qa-resource-id={tab.id}
                  data-qa-state={isActive ? "active" : "inactive"}
                  data-testid="layout.tab-bar.overflow-item"
                  key={tab.id}
                  onClick={() => handleOverflowSelect(tab.id)}
                >
                  {getTabIcon(tab.type, isActive)}
                  <span className="truncate">{tab.title}</span>
                  {tab.isDirty && <span className="ml-1 text-primary">•</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {contextMenu && (
        <PointerContextMenu
          items={[
            {
              label: "Close tab",
              onClick: () => handleMenuAction("close"),
              icon: <X className="h-4 w-4" />,
            },
            {
              label: "Close other tabs",
              onClick: () => handleMenuAction("closeOthers"),
              icon: <SplitSquareHorizontal className="h-4 w-4" />,
            },
            { separator: true } as const,
            {
              label: "Close all tabs",
              onClick: () => handleMenuAction("closeAll"),
              icon: <X className="h-4 w-4" />,
            },
          ]}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
    </div>
  );
}
