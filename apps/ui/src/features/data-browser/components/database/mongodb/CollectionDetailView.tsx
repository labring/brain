import type { AccessObjectRef } from "@data-browser/api/access-types";
import { DataView } from "@data-browser/components/database/shared/DataView";
import { FindBar } from "@data-browser/components/database/shared/FindBar";
import { SingleObjectExportModal } from "@data-browser/components/database/shared/SingleObjectExportModal";
import { AlertModal } from "@data-browser/components/ui/AlertModal";
import { ConfirmationModal } from "@data-browser/components/ui/ConfirmationModal";
import { ScrollArea } from "@data-browser/components/ui/scroll-area";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { useMemo } from "react";
import { AddDocumentModal } from "./CollectionView/CollectionView.AddDocumentModal";
import { CollectionViewDocumentList } from "./CollectionView/CollectionView.DocumentList";
import { EditDocumentModal } from "./CollectionView/CollectionView.EditDocumentModal";
import { CollectionViewToolbar } from "./CollectionView/CollectionView.Toolbar";
import {
  CollectionViewProvider,
  useCollectionView,
} from "./CollectionView/CollectionViewProvider";
import {
  buildPreviewCommands,
  summarizeChanges,
} from "./CollectionView/changeset-mongo-preview";

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

  const previewCommands = buildPreviewCommands(collectionName, state.changes);
  const summary = summarizeChanges(state.changes);

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

  if (state.loading && !state.documents.length && !state.showAddModal) {
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

      <AddDocumentModal
        content={state.addContent}
        onContentChange={actions.setAddContent}
        onOpenChange={actions.setShowAddModal}
        onSave={actions.handleAddSave}
        open={state.showAddModal}
      />

      <EditDocumentModal
        content={state.editContent}
        onContentChange={actions.setEditContent}
        onOpenChange={(open) => {
          if (!open) {
            actions.cancelEdit();
          }
        }}
        onSave={actions.handleEditSave}
        open={state.editingRowKey !== null}
      />

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

      <AppDialog.Root
        onOpenChange={actions.setShowPreviewModal}
        open={state.showPreviewModal}
      >
        <AppDialog.Content
          data-qa-module="mongodb"
          data-qa-object="changes-preview"
          data-qa-resource-id={collectionName}
          data-qa-resource-type="collection"
          data-qa-risk="resource_mutation"
          data-qa-state="open"
          data-testid="mongodb.collection.changes-preview-dialog"
          size="lg"
        >
          <AppDialog.Header>
            <AppDialog.Title>{"Preview document changes"}</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body className="pb-4">
            <AppDialog.Description>
              {`${state.pendingChangeCount} pending document change(s).`}
            </AppDialog.Description>
            <ScrollArea className="max-h-[60vh] rounded-md border border-white/10 bg-black/20">
              <pre
                className="whitespace-pre-wrap p-4 font-mono text-xs text-zinc-200"
                data-qa-module="mongodb"
                data-qa-object="changes-preview"
                data-qa-state={state.pendingChangeCount > 0 ? "ready" : "empty"}
                data-testid="mongodb.collection.changes-preview-command"
              >
                {previewCommands.join("\n\n")}
              </pre>
            </ScrollArea>
          </AppDialog.Body>
        </AppDialog.Content>
      </AppDialog.Root>

      <ConfirmationModal
        confirmText={"Confirm"}
        isOpen={state.showSubmitModal}
        message={`Submit document changes? Updates: ${summary.updates}, inserts: ${summary.inserts}, deletes: ${summary.deletes}.`}
        onClose={() => actions.setShowSubmitModal(false)}
        onConfirm={actions.submitChanges}
        title={`Submit ${state.pendingChangeCount} document change(s)?`}
      />

      <ConfirmationModal
        confirmText={"Discard"}
        isOpen={state.showDiscardModal}
        message={`Discard ${state.pendingChangeCount} pending document change(s)?`}
        onClose={() => actions.setShowDiscardModal(false)}
        onConfirm={actions.confirmDiscardAndContinue}
        title={"Discard changes?"}
      />

      {state.alert && (
        <AlertModal isOpen onClose={actions.closeAlert} {...state.alert} />
      )}
    </div>
  );
}
