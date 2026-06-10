/** Context value exposed by CollectionViewProvider. */
export interface CollectionViewContextValue {
  actions: CollectionViewActions;
  state: CollectionViewState;
}

/** All state managed by the CollectionView provider. */
export interface CollectionViewState {
  currentPage: number;
  documents: Record<string, unknown>[];
  error: string | null;
  loading: boolean;
  pageSize: number;
  showExportModal: boolean;
  total: number;
  totalPages: number;
}

/** All actions exposed by the CollectionView provider. */
export interface CollectionViewActions {
  handlePageChange: (page: number) => void;
  handlePageSizeChange: (size: number) => void;
  refresh: () => void;
  setShowExportModal: (open: boolean) => void;
}
