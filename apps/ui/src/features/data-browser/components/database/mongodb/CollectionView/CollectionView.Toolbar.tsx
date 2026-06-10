import { cn } from "@data-browser/lib/utils";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Download, RefreshCw } from "lucide-react";
import { useCollectionView } from "./CollectionViewProvider";

interface CollectionViewToolbarProps {
  collectionName: string;
  databaseName: string;
  dbServiceKey: string;
}

export function CollectionViewToolbar({
  databaseName,
  dbServiceKey,
  collectionName,
}: CollectionViewToolbarProps) {
  const { state, actions } = useCollectionView();
  return (
    <div
      className="flex h-12 items-center justify-between px-2"
      data-qa-database={databaseName}
      data-qa-db-service-key={dbServiceKey}
      data-qa-module="mongodb"
      data-qa-object="collection-toolbar"
      data-qa-resource-id={collectionName}
      data-qa-resource-type="collection"
      data-qa-state={state.loading ? "loading" : "ready"}
      data-testid="mongodb.collection.toolbar"
    >
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <AppIconButton
                aria-label="Refresh"
                data-qa-action="refresh"
                data-qa-disabled-reason={state.loading ? "loading" : undefined}
                data-qa-module="mongodb"
                data-qa-object="collection-data"
                data-qa-state={state.loading ? "loading" : "ready"}
                data-testid="mongodb.collection.refresh-button"
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
                data-qa-module="mongodb"
                data-qa-object="collection-data"
                data-testid="mongodb.collection.export-button"
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
