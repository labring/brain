import type { AccessObjectRef } from "@data-browser/api/access-types";
import { DataView } from "@data-browser/components/database/shared/DataView";
import { FindBar } from "@data-browser/components/database/shared/FindBar";
import { SingleObjectExportModal } from "@data-browser/components/database/shared/SingleObjectExportModal";
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
    </div>
  );
}
