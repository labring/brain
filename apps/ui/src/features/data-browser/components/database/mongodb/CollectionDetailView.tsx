import type { AccessObjectRef } from "@data-browser/api/access-types";
import { DataView } from "@data-browser/components/database/shared/DataView";
import { FindBar } from "@data-browser/components/database/shared/FindBar";
import { SingleObjectExportModal } from "@data-browser/components/database/shared/SingleObjectExportModal";
import { useMemo } from "react";
import { CollectionViewDocumentList } from "./CollectionView/CollectionView.DocumentList";
import { CollectionViewToolbar } from "./CollectionView/CollectionView.Toolbar";
import {
  CollectionViewProvider,
  useCollectionView,
} from "./CollectionView/CollectionViewProvider";

interface CollectionDetailViewProps {
  collectionName: string;
  databaseName: string;
  dbServiceKey: string;
  objectRef: AccessObjectRef;
}

/** MongoDB collection detail view composed from Provider + subcomponents. */
export function CollectionDetailView(props: CollectionDetailViewProps) {
  return (
    <CollectionViewProvider {...props}>
      <CollectionDetailViewContent {...props} />
    </CollectionViewProvider>
  );
}

/** Inner content rendered within the CollectionViewProvider context. */
function CollectionDetailViewContent({
  databaseName,
  collectionName,
  dbServiceKey,
  objectRef,
}: CollectionDetailViewProps) {
  const { state, actions } = useCollectionView();

  /** Extract all top-level field names from visible documents for FindBar. */
  const docColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const doc of state.documents) {
      if (typeof doc === "object" && doc !== null) {
        for (const key of Object.keys(doc)) {
          keys.add(key);
        }
      }
    }
    return Array.from(keys);
  }, [state.documents]);

  if (state.loading && !state.documents.length) {
    return (
      <div
        className="flex h-full"
        data-qa-database={databaseName}
        data-qa-db-service-key={dbServiceKey}
        data-qa-loading="true"
        data-qa-module="mongodb"
        data-qa-object="collection-detail"
        data-qa-resource-id={collectionName}
        data-qa-resource-type="collection"
        data-qa-state="loading"
        data-testid="mongodb.collection.detail-loading"
      >
        <DataView.Loading />
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col bg-background"
      data-qa-database={databaseName}
      data-qa-db-service-key={dbServiceKey}
      data-qa-loading={state.loading ? "true" : "false"}
      data-qa-module="mongodb"
      data-qa-object="collection-detail"
      data-qa-resource-id={collectionName}
      data-qa-resource-type="collection"
      data-qa-state={
        state.error ? "error" : state.loading ? "loading" : "ready"
      }
      data-testid="mongodb.collection.detail"
    >
      <CollectionViewToolbar
        collectionName={collectionName}
        databaseName={databaseName}
        dbServiceKey={dbServiceKey}
      />

      {state.error ? (
        <DataView.Error message={state.error} />
      ) : (
        <FindBar.Provider columns={docColumns} rows={state.documents}>
          <FindBar.Bar />
          <div
            className="flex-1 space-y-4 overflow-auto p-4"
            data-qa-module="mongodb"
            data-qa-object="document-list"
            data-qa-state={state.documents.length > 0 ? "ready" : "empty"}
            data-testid="mongodb.collection.document-list-region"
          >
            <CollectionViewDocumentList />
          </div>
        </FindBar.Provider>
      )}

      {state.total > 0 && (
        <DataView.Pagination
          currentPage={state.currentPage}
          itemLabel={"documents"}
          loading={state.loading}
          onPageChange={actions.handlePageChange}
          onPageSizeChange={actions.handlePageSizeChange}
          pageSize={state.pageSize}
          total={state.total}
          totalPages={state.totalPages}
        />
      )}

      <SingleObjectExportModal
        objectRef={objectRef}
        onOpenChange={(open) => {
          if (!open) {
            actions.setShowExportModal(false);
          }
        }}
        open={state.showExportModal}
        title={collectionName}
      />
    </div>
  );
}
