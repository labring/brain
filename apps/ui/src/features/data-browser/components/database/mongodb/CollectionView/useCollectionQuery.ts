import { getRows } from "@data-browser/api/access-adapter";
import type { AccessObjectRef } from "@data-browser/api/access-types";
import { useDbAccessRuntime } from "@data-browser/state/db-access-session";
import { useDbAccessViewState } from "@data-browser/state/db-access-view-state";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseCollectionQueryParams {
  currentPage: number;
  objectRef: AccessObjectRef;
  pageSize: number;
  viewKey: string;
}

export function useCollectionQuery({
  currentPage,
  objectRef,
  pageSize,
  viewKey,
}: UseCollectionQueryParams) {
  const runtime = useDbAccessRuntime();
  const viewState = useDbAccessViewState(viewKey);
  const refreshVersion = useAtomValue(viewState.refreshVersionAtom);
  const refresh = useSetAtom(viewState.triggerRefreshAtom);
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const latestRequestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    latestRequestIdRef.current += 1;
    const requestId = latestRequestIdRef.current;

    try {
      const result = await getRows({
        pageOffset: (currentPage - 1) * pageSize,
        pageSize,
        ref: objectRef,
        runtime,
      });
      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      setDocuments(
        result.rows.map((row): Record<string, unknown> => {
          const rawDocument = String(row[0] ?? "{}");
          try {
            const parsed: unknown = JSON.parse(rawDocument);
            return typeof parsed === "object" && parsed !== null
              ? (parsed as Record<string, unknown>)
              : { value: parsed };
          } catch {
            return { _raw: rawDocument };
          }
        })
      );
      setTotal(result.totalCount);
    } catch (caught) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to fetch collection data"
      );
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [currentPage, objectRef, pageSize, runtime]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshVersion]);

  return { documents, error, loading, refresh, total };
}
