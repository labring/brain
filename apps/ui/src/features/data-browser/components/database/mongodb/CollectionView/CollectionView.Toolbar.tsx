import type { AccessObjectRef } from "@data-browser/api/access-types";
import { SingleObjectExportModal } from "@data-browser/components/database/shared/SingleObjectExportModal";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Download, RefreshCw } from "lucide-react";
import { memo, useState } from "react";

interface CollectionViewToolbarProps {
  collectionName: string;
  databaseName: string;
  dbServiceKey: string;
  loading: boolean;
  objectRef: AccessObjectRef;
  onRefresh: () => void;
}

export const CollectionViewToolbar = memo(function CollectionViewToolbar({
  collectionName,
  databaseName,
  dbServiceKey,
  loading,
  objectRef,
  onRefresh,
}: CollectionViewToolbarProps) {
  const [showExportModal, setShowExportModal] = useState(false);

  return (
    <>
      <div
        className="flex h-12 items-center justify-between px-2"
        data-qa-database={databaseName}
        data-qa-db-service-key={dbServiceKey}
        data-qa-module="mongodb"
        data-qa-object="collection-toolbar"
        data-qa-resource-id={collectionName}
        data-qa-resource-type="collection"
        data-qa-state={loading ? "loading" : "ready"}
        data-testid="mongodb.collection.toolbar"
      >
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <AppIconButton
                  aria-label="Refresh"
                  data-qa-action="refresh"
                  data-qa-disabled-reason={loading ? "loading" : undefined}
                  data-qa-module="mongodb"
                  data-qa-object="collection-data"
                  data-qa-state={loading ? "loading" : "ready"}
                  data-testid="mongodb.collection.refresh-button"
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
                  data-qa-module="mongodb"
                  data-qa-object="collection-data"
                  data-testid="mongodb.collection.export-button"
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

      <SingleObjectExportModal
        objectRef={objectRef}
        onOpenChange={setShowExportModal}
        open={showExportModal}
        title={collectionName}
      />
    </>
  );
});
