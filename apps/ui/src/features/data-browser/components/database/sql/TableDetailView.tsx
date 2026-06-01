import type { AccessObjectRef } from "@data-browser/api/access-types";
import { DataView } from "@data-browser/components/database/shared/DataView";
import { FindBar } from "@data-browser/components/database/shared/FindBar";
import { SingleObjectExportModal } from "@data-browser/components/database/shared/SingleObjectExportModal";
import { AlertModal } from "@data-browser/components/ui/AlertModal";
import { ConfirmationModal } from "@data-browser/components/ui/ConfirmationModal";
import { ScrollArea } from "@data-browser/components/ui/scroll-area";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import {
  buildPreviewSql,
  summarizeChanges,
} from "./TableView/changeset-sql-preview";
import { TableViewDataGrid } from "./TableView/TableView.DataGrid";
import { TableViewToolbar } from "./TableView/TableView.Toolbar";
import { TableViewProvider, useTableView } from "./TableView/TableViewProvider";

interface TableDetailViewProps {
  databaseName: string;
  dbServiceKey: string;
  objectRef: AccessObjectRef;
  schema?: string;
  tableName: string;
}

export function TableDetailView(props: TableDetailViewProps) {
  return (
    <TableViewProvider {...props}>
      <TableDetailViewContent {...props} />
    </TableViewProvider>
  );
}

function TableDetailViewContent({
  databaseName,
  dbServiceKey,
  objectRef,
  tableName,
  schema,
}: TableDetailViewProps) {
  const { state, actions } = useTableView();

  const previewStatements = buildPreviewSql(tableName, state.changes);
  const summary = summarizeChanges(state.changes);

  return (
    <div
      className="flex h-full flex-col"
      data-qa-database={databaseName}
      data-qa-db-service-key={dbServiceKey}
      data-qa-loading={state.loading ? "true" : "false"}
      data-qa-module="sql"
      data-qa-object="table-detail"
      data-qa-resource-id={tableName}
      data-qa-resource-type="table"
      data-qa-schema={schema}
      data-qa-state={
        state.error ? "error" : state.loading ? "loading" : "ready"
      }
      data-testid="sql.table.detail"
    >
      <TableViewToolbar
        databaseName={databaseName}
        dbServiceKey={dbServiceKey}
        schema={schema}
        tableName={tableName}
      />

      {state.error ? (
        <DataView.Error
          message={state.error}
          onRetry={() => actions.handleSubmitRequest()}
        />
      ) : (
        <FindBar.Provider
          columns={state.visibleColumns}
          rows={state.renderedRows.map((row) => row.values)}
        >
          <FindBar.Bar />
          <TableViewDataGrid />
        </FindBar.Provider>
      )}

      {state.total > 0 && (
        <DataView.Pagination
          currentPage={state.currentPage}
          loading={state.loading}
          onPageChange={actions.handlePageChange}
          onPageSizeChange={actions.handlePageSizeChange}
          pageSize={state.pageSize}
          total={state.total}
          totalPages={state.totalPages}
        />
      )}

      {state.showExportModal && (
        <SingleObjectExportModal
          objectRef={objectRef}
          onOpenChange={(open) => {
            if (!open) {
              actions.setShowExportModal(false);
            }
          }}
          open={state.showExportModal}
          title={tableName}
        />
      )}

      <AppDialog.Root
        onOpenChange={actions.setShowPreviewModal}
        open={state.showPreviewModal}
      >
        <AppDialog.Content
          data-qa-module="sql"
          data-qa-object="changes-preview"
          data-qa-resource-id={tableName}
          data-qa-resource-type="table"
          data-qa-risk="resource_mutation"
          data-qa-state="open"
          data-testid="sql.table.changes-preview-dialog"
          size="lg"
        >
          <AppDialog.Header>
            <AppDialog.Title>{"Preview changes"}</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body className="pb-4">
            <AppDialog.Description>
              {`${state.pendingChangeCount} pending change(s).`}
            </AppDialog.Description>

            <ScrollArea className="max-h-[60vh] rounded-md border border-white/10 bg-black/20">
              <pre
                className="whitespace-pre-wrap p-4 font-mono text-xs text-zinc-200"
                data-qa-module="sql"
                data-qa-object="changes-preview"
                data-qa-state={state.pendingChangeCount > 0 ? "ready" : "empty"}
                data-testid="sql.table.changes-preview-sql"
              >
                {previewStatements.join("\n\n")}
              </pre>
            </ScrollArea>
          </AppDialog.Body>
        </AppDialog.Content>
      </AppDialog.Root>

      <ConfirmationModal
        confirmText={"Confirm"}
        isOpen={state.showSubmitModal}
        message={`Submit ${state.pendingChangeCount} change(s)? Updates: ${summary.updates}, inserts: ${summary.inserts}, deletes: ${summary.deletes}.`}
        onClose={() => actions.setShowSubmitModal(false)}
        onConfirm={actions.submitChanges}
        title={`Submit ${state.pendingChangeCount} change(s)?`}
      />

      <ConfirmationModal
        confirmText={"Discard"}
        isOpen={state.showDiscardModal}
        message={`Discard ${state.pendingChangeCount} pending change(s)?`}
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
