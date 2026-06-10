import type { TableData } from "@data-browser/utils/graphql-transforms";

export type ChangesetCellValue = string | null;
export type ChangesetRowKey = string;

export interface RenderedTableRow {
  originalRow: Record<string, ChangesetCellValue>;
  rowKey: ChangesetRowKey;
  rowNumber: number | null;
  sourceRowIndex: number | null;
  values: Record<string, ChangesetCellValue>;
}

/** Context value exposed by TableViewProvider. */
export interface TableViewContextValue {
  actions: TableViewActions;
  state: TableViewState;
}

/** All state managed by the TableView provider. */
export interface TableViewState {
  activeColumnMenu: string | null;
  columnWidths: Record<string, number>;
  currentPage: number;
  data: TableData | null;
  error: string | null;
  foreignKeyColumns: string[];
  loading: boolean;
  pageSize: number;
  primaryKey: string | null;
  renderedRows: RenderedTableRow[];
  resizedColumns: Set<string>;
  resizingColumn: string | null;
  showExportModal: boolean;
  sortColumn: string | null;
  sortDirection: "asc" | "desc" | null;
  total: number;
  totalPages: number;
  visibleColumns: string[];
}

/** All actions exposed by the TableView provider. */
export interface TableViewActions {
  clearSort: () => void;
  handlePageChange: (page: number) => void;
  handlePageSizeChange: (size: number) => void;
  handleResizeStart: (e: React.MouseEvent, column: string) => void;
  handleSort: (column: string, direction: "asc" | "desc") => void;
  handleSubmitRequest: (overridePageOffset?: number) => Promise<void>;
  refresh: () => void;
  setActiveColumnMenu: (col: string | null) => void;
  setShowExportModal: (open: boolean) => void;
}
