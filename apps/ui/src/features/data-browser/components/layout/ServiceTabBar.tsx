import { cn } from "@data-browser/lib/utils";
import { useDbAccessTabs } from "@data-browser/state/db-access-session";
import { Archive } from "lucide-react";

export function ServiceTabBar() {
  const { activeSurface, setActiveServiceTab } = useDbAccessTabs();
  const isActive =
    activeSurface.kind === "service" && activeSurface.tab === "backup";

  return (
    <div
      className="mb-2 border-sidebar-border border-b"
      data-qa-module="layout"
      data-qa-object="service-tab-bar"
      data-qa-state="ready"
      data-testid="layout.service-tab-bar"
    >
      <div className="flex items-center pr-2">
        <button
          className={cn(
            "flex h-9 cursor-pointer select-none items-center gap-2 border-sidebar-border border-r px-3 text-sm transition-colors duration-150",
            isActive
              ? "bg-input text-foreground"
              : "text-foreground hover:bg-input"
          )}
          data-qa-action="activate"
          data-qa-module="layout"
          data-qa-object="service-tab"
          data-qa-state={isActive ? "active" : "inactive"}
          data-qa-tab-type="backup"
          data-testid="layout.service-tab.item"
          onClick={() => setActiveServiceTab("backup")}
          type="button"
        >
          <Archive className={cn("h-4 w-4", isActive && "text-blue-400")} />
          <span className="whitespace-nowrap font-normal">{"Backup"}</span>
        </button>
      </div>
    </div>
  );
}
