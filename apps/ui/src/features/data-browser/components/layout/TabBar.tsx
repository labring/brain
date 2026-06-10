import { PointerContextMenu } from "@data-browser/components/shared/PointerContextMenu";
import {
  type DbAccessTab,
  type DbAccessTabType,
  useDbAccessTabs,
} from "@data-browser/state/db-access-session";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  Database,
  KeyRound,
  SplitSquareHorizontal,
  Table,
  X,
} from "lucide-react";
import type React from "react";
import { useState } from "react";

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
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
  closeTitle,
}: TabItemProps) {
  return (
    <div
      className={cn(
        "group flex h-9 cursor-pointer select-none items-center gap-1 border-sidebar-border border-r p-2 pl-3 transition-colors duration-150",
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
    >
      <span className="mr-1 flex-shrink-0">
        {getTabIcon(tab.type, isActive)}
      </span>
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

  if (tabs.length === 0) {
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

  return (
    <ScrollArea
      className="mb-2 border-sidebar-border border-b"
      data-qa-module="layout"
      data-qa-object="tab-bar"
      data-qa-state={tabs.length > 0 ? "ready" : "empty"}
      data-testid="layout.tab-bar"
    >
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
          />
        ))}
      </div>

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
    </ScrollArea>
  );
}
