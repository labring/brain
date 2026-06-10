import { getRows } from "@data-browser/api/access-adapter";
import type { AccessObjectRef } from "@data-browser/api/access-types";
import {
  useDbAccessRefresh,
  useDbAccessRuntime,
} from "@data-browser/state/db-access-session";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";
import type { CollectionViewContextValue } from "./types";

const CollectionViewCtx = createContext<CollectionViewContextValue | null>(
  null
);

/** Hook to access CollectionView context. Throws if used outside CollectionViewProvider. */
export function useCollectionView(): CollectionViewContextValue {
  const ctx = use(CollectionViewCtx);
  if (!ctx) {
    throw new Error(
      "useCollectionView must be used within CollectionViewProvider"
    );
  }
  return ctx;
}

interface CollectionViewProviderProps {
  children: ReactNode;
  collectionName: string;
  databaseName: string;
  dbServiceKey: string;
  objectRef: AccessObjectRef;
}

/** Provider that owns MongoDB collection data, pagination, refresh, and export state. */
export function CollectionViewProvider({
  objectRef,
  children,
}: CollectionViewProviderProps) {
  const runtime = useDbAccessRuntime();
  const { collectionRefreshKey } = useDbAccessRefresh();

  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await getRows({
          runtime,
          ref: objectRef,
          pageSize,
          pageOffset: (currentPage - 1) * pageSize,
        });

        const parsedDocs = result.rows.map((row): Record<string, unknown> => {
          const rawDocument = String(row[0] ?? "{}");
          try {
            const parsed = JSON.parse(rawDocument);
            if (typeof parsed === "object" && parsed !== null) {
              return parsed as Record<string, unknown>;
            }
            return { value: parsed };
          } catch {
            return { _raw: rawDocument };
          }
        });
        setDocuments(parsedDocs);
        setTotal(result.totalCount);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to fetch collection data";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [
    collectionRefreshKey,
    currentPage,
    pageSize,
    objectRef,
    refreshKey,
    runtime,
  ]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  const state: CollectionViewContextValue["state"] = {
    loading,
    documents,
    error,
    currentPage,
    pageSize,
    total,
    totalPages,
    showExportModal,
  };

  const actions: CollectionViewContextValue["actions"] = {
    refresh,
    handlePageChange,
    handlePageSizeChange,
    setShowExportModal,
  };

  return (
    <CollectionViewCtx value={{ state, actions }}>{children}</CollectionViewCtx>
  );
}
