import type { AccessObjectRef } from "@data-browser/api/access-types";
import { DataView } from "@data-browser/components/database/shared/DataView";
import {
  FindBar,
  useFindInView,
} from "@data-browser/components/database/shared/FindBar";
import { useDbAccessViewState } from "@data-browser/state/db-access-view-state";
import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useMemo, useRef } from "react";
import { CollectionViewDocumentList } from "./CollectionView/CollectionView.DocumentList";
import { CollectionViewToolbar } from "./CollectionView/CollectionView.Toolbar";
import { useCollectionQuery } from "./CollectionView/useCollectionQuery";

interface CollectionDetailViewProps {
  active: boolean;
  collectionName: string;
  databaseName: string;
  dbServiceKey: string;
  objectRef: AccessObjectRef;
  viewKey: string;
}

function CollectionFindRegion({
  active,
  columns,
  currentPage,
  documents,
  pageSize,
  rootRef,
  viewKey,
}: {
  active: boolean;
  columns: string[];
  currentPage: number;
  documents: Record<string, unknown>[];
  pageSize: number;
  rootRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
}) {
  const find = useFindInView({
    active,
    columns,
    rootRef,
    rows: documents,
    scrollTarget: "row",
    viewKey,
  });

  return (
    <>
      <FindBar.Bar find={find} />
      <div
        className="flex-1 space-y-4 overflow-auto p-4"
        data-qa-module="mongodb"
        data-qa-object="document-list"
        data-qa-state={documents.length > 0 ? "ready" : "empty"}
        data-testid="mongodb.collection.document-list-region"
      >
        <CollectionViewDocumentList
          currentPage={currentPage}
          documents={documents}
          find={find}
          pageSize={pageSize}
        />
      </div>
    </>
  );
}

export function CollectionDetailView({
  active,
  collectionName,
  databaseName,
  dbServiceKey,
  objectRef,
  viewKey,
}: CollectionDetailViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewState = useDbAccessViewState(viewKey);
  const pagination = useAtomValue(viewState.paginationAtom);
  const setCurrentPage = useSetAtom(viewState.setCurrentPageAtom);
  const setPageSize = useSetAtom(viewState.setPageSizeAtom);
  const query = useCollectionQuery({
    currentPage: pagination.currentPage,
    objectRef,
    pageSize: pagination.pageSize,
    viewKey,
  });
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const document of query.documents) {
      for (const key of Object.keys(document)) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }, [query.documents]);
  const totalPages = Math.ceil(query.total / pagination.pageSize);

  if (query.loading && query.documents.length === 0) {
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
      data-qa-loading={query.loading ? "true" : "false"}
      data-qa-module="mongodb"
      data-qa-object="collection-detail"
      data-qa-resource-id={collectionName}
      data-qa-resource-type="collection"
      data-qa-state={
        query.error ? "error" : query.loading ? "loading" : "ready"
      }
      data-testid="mongodb.collection.detail"
      ref={rootRef}
    >
      <CollectionViewToolbar
        collectionName={collectionName}
        databaseName={databaseName}
        dbServiceKey={dbServiceKey}
        loading={query.loading}
        objectRef={objectRef}
        onRefresh={query.refresh}
      />

      {query.error ? (
        <DataView.Error message={query.error} />
      ) : (
        <CollectionFindRegion
          active={active}
          columns={columns}
          currentPage={pagination.currentPage}
          documents={query.documents}
          pageSize={pagination.pageSize}
          rootRef={rootRef}
          viewKey={viewKey}
        />
      )}

      {query.total > 0 && (
        <DataView.Pagination
          currentPage={pagination.currentPage}
          itemLabel="documents"
          loading={query.loading}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          pageSize={pagination.pageSize}
          total={query.total}
          totalPages={totalPages}
        />
      )}
    </div>
  );
}
