import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Download, RefreshCw } from "lucide-react";
import { useTableView } from "./TableViewProvider";

interface TableViewToolbarProps {
  databaseName: string;
  dbServiceKey: string;
  schema?: string;
  tableName: string;
}

export function TableViewToolbar({
  databaseName,
  dbServiceKey,
  tableName,
  schema,
}: TableViewToolbarProps) {
  const { state, actions } = useTableView();
  return (
    <div
      className="flex h-11 items-center justify-between px-2"
      data-qa-database={databaseName}
      data-qa-db-service-key={dbServiceKey}
      data-qa-module="sql"
      data-qa-object="table-toolbar"
      data-qa-resource-id={tableName}
      data-qa-resource-type="table"
      data-qa-schema={schema}
      data-qa-state={state.loading ? "loading" : "ready"}
      data-testid="sql.table.toolbar"
    >
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <AppIconButton
                aria-label="Refresh"
                data-qa-action="refresh"
                data-qa-disabled-reason={state.loading ? "loading" : undefined}
                data-qa-module="sql"
                data-qa-object="table-data"
                data-qa-state={state.loading ? "loading" : "ready"}
                data-testid="sql.table.refresh-button"
                disabled={state.loading}
                onClick={actions.refresh}
                size="md"
                variant="quiet"
              >
                <RefreshCw
                  className={cn("h-4 w-4", state.loading && "animate-spin")}
                />
              </AppIconButton>
            }
          />
          <TooltipContent>{"Refresh"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <AppIconButton
                aria-label="Export"
                data-qa-action="export"
                data-qa-module="sql"
                data-qa-object="table-data"
                data-testid="sql.table.export-button"
                onClick={() => actions.setShowExportModal(true)}
                size="md"
                variant="quiet"
              >
                <Download className="h-4 w-4" />
              </AppIconButton>
            }
          />
          <TooltipContent>{"Export"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
