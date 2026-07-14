export type ChangesetCellValue = string | null;
export type ChangesetRowKey = string;

export interface RenderedTableRow {
  originalRow: Record<string, ChangesetCellValue>;
  rowKey: ChangesetRowKey;
  rowNumber: number | null;
  sourceRowIndex: number | null;
  values: Record<string, ChangesetCellValue>;
}
