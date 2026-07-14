import { useDbAccessTabs } from "@db-browser/state/db-access-session";
import { cn } from "@workspace/ui/lib/utils";
import { CloudUpload } from "lucide-react";

const serviceTabActiveClassName = "bg-input text-foreground";
const serviceTabInactiveClassName = "text-foreground hover:bg-input/40";

export function ServiceTabBar() {
  const { activeSurface, setActiveServiceTab } = useDbAccessTabs();
  const isActive =
    activeSurface.kind === "service" && activeSurface.tab === "backup";

  return (
    <div
      className="px-3 pt-3 pb-2"
      data-qa-module="layout"
      data-qa-object="service-tab-bar"
      data-qa-state="ready"
      data-testid="layout.service-tab-bar"
    >
      <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-border bg-transparent">
        <button
          className={cn(
            "inline-flex h-9 cursor-pointer select-none items-center gap-2 px-4 font-medium text-sm transition-colors duration-150",
            isActive ? serviceTabActiveClassName : serviceTabInactiveClassName
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
          <CloudUpload className={cn("size-4", isActive && "text-blue-400")} />
          <span className="whitespace-nowrap">{"Backup"}</span>
        </button>
      </div>
    </div>
  );
}
