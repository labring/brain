import type { AccessObjectRef } from "@db-browser/api/access-types";
import { SingleObjectExportModal } from "@db-browser/components/database/shared/SingleObjectExportModal";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Download, RefreshCw } from "lucide-react";
import { memo, useState } from "react";

interface TableViewToolbarProps {
  databaseName: string;
  dbServiceKey: string;
  loading: boolean;
  objectRef: AccessObjectRef;
  onRefresh: () => void;
  schema?: string;
  tableName: string;
}

export const TableViewToolbar = memo(function TableViewToolbar({
  databaseName,
  dbServiceKey,
  loading,
  objectRef,
  onRefresh,
  tableName,
  schema,
}: TableViewToolbarProps) {
  const [showExportModal, setShowExportModal] = useState(false);

  return (
    <>
      <div
        className="flex h-11 items-center justify-between px-2"
        data-qa-database={databaseName}
        data-qa-db-service-key={dbServiceKey}
        data-qa-module="sql"
        data-qa-object="table-toolbar"
        data-qa-resource-id={tableName}
        data-qa-resource-type="table"
        data-qa-schema={schema}
        data-qa-state={loading ? "loading" : "ready"}
        data-testid="sql.table.toolbar"
      >
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <AppIconButton
                  aria-label="Refresh"
                  data-qa-action="refresh"
                  data-qa-disabled-reason={loading ? "loading" : undefined}
                  data-qa-module="sql"
                  data-qa-object="table-data"
                  data-qa-state={loading ? "loading" : "ready"}
                  data-testid="sql.table.refresh-button"
                  disabled={loading}
                  onClick={onRefresh}
                  size="md"
                  variant="quiet"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", loading && "animate-spin")}
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
                  onClick={() => setShowExportModal(true)}
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

      {showExportModal && (
        <SingleObjectExportModal
          objectRef={objectRef}
          onOpenChange={setShowExportModal}
          open={showExportModal}
          title={tableName}
        />
      )}
    </>
  );
});
