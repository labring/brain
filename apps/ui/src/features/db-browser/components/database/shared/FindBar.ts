import { useDbAccessViewState } from "@db-browser/state/db-access-view-state";
import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { FindBarBar } from "./FindBar.Bar";

export interface FindMatch {
  columnKey: string;
  rowIndex: number;
}

export type FindHighlight = "current" | "match" | null;

export interface FindHighlightIndex {
  cellKeys: ReadonlySet<string>;
  rowIndexes: ReadonlySet<number>;
}

export interface FindResult {
  highlightIndex: FindHighlightIndex;
  matches: FindMatch[];
}

export interface FindCorpusEntry extends FindMatch {
  normalizedValue: string;
}

export type FindCorpus = readonly FindCorpusEntry[];

export interface FindBarModel {
  actions: {
    clear: () => void;
    goToNext: () => void;
    goToPrevious: () => void;
    setSearchTerm: (term: string) => void;
  };
  meta: {
    getTargetId: (rowIndex: number, columnKey: string) => string;
    inputRef: RefObject<HTMLInputElement | null>;
  };
  state: {
    currentMatch: FindMatch | undefined;
    currentMatchIndex: number;
    highlightIndex: FindHighlightIndex;
    matches: FindMatch[];
    searchTerm: string;
    total: number;
  };
}

interface UseFindInViewParams {
  active: boolean;
  columns: string[] | undefined;
  rootRef: RefObject<HTMLElement | null>;
  rows: Record<string, unknown>[] | undefined;
  scrollTarget?: "cell" | "row";
  viewKey: string;
}

function findCellKey(rowIndex: number, columnKey: string) {
  return `${rowIndex}:${columnKey.length}:${columnKey}`;
}

export function buildFindCorpus(
  rows: Record<string, unknown>[] | undefined,
  columns: string[] | undefined
): FindCorpus {
  if (!(rows && columns)) {
    return [];
  }

  const corpus: FindCorpusEntry[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) {
      continue;
    }
    for (const columnKey of columns) {
      const value = row[columnKey];
      if (value != null) {
        corpus.push({
          columnKey,
          normalizedValue: String(value).toLowerCase(),
          rowIndex,
        });
      }
    }
  }
  return corpus;
}

export function findInCorpus(
  corpus: FindCorpus,
  searchTerm: string
): FindResult {
  const term = searchTerm.trim().toLowerCase();
  const cellKeys = new Set<string>();
  const matches: FindMatch[] = [];
  const rowIndexes = new Set<number>();
  if (!term) {
    return { highlightIndex: { cellKeys, rowIndexes }, matches };
  }

  for (const entry of corpus) {
    if (entry.normalizedValue.includes(term)) {
      const match = { columnKey: entry.columnKey, rowIndex: entry.rowIndex };
      matches.push(match);
      cellKeys.add(findCellKey(match.rowIndex, match.columnKey));
      rowIndexes.add(match.rowIndex);
    }
  }
  return { highlightIndex: { cellKeys, rowIndexes }, matches };
}

export function findCellHighlight(
  index: FindHighlightIndex,
  currentMatch: FindMatch | undefined,
  rowIndex: number,
  columnKey: string
): FindHighlight {
  if (
    currentMatch?.rowIndex === rowIndex &&
    currentMatch.columnKey === columnKey
  ) {
    return "current";
  }
  return index.cellKeys.has(findCellKey(rowIndex, columnKey)) ? "match" : null;
}

export function findRowHighlight(
  index: FindHighlightIndex,
  currentMatch: FindMatch | undefined,
  rowIndex: number
): FindHighlight {
  if (currentMatch?.rowIndex === rowIndex) {
    return "current";
  }
  return index.rowIndexes.has(rowIndex) ? "match" : null;
}

export function findTargetId(
  viewKey: string,
  rowIndex: number,
  columnKey?: string
) {
  const target = columnKey == null ? "row" : `cell-${columnKey}`;
  return `db-access-find-${encodeURIComponent(viewKey)}-${rowIndex}-${encodeURIComponent(target)}`;
}

export function useFindInView({
  active,
  columns,
  rootRef,
  rows,
  scrollTarget = "cell",
  viewKey,
}: UseFindInViewParams): FindBarModel {
  const viewState = useDbAccessViewState(viewKey);
  const searchTerm = useAtomValue(viewState.findTermAtom);
  const currentMatchIndex = useAtomValue(viewState.currentFindMatchAtom);
  const setSearchTerm = useSetAtom(viewState.setFindTermAtom);
  const setCurrentMatchIndex = useSetAtom(viewState.currentFindMatchAtom);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const corpus = useMemo(() => buildFindCorpus(rows, columns), [columns, rows]);
  const findResult = useMemo(
    () => findInCorpus(corpus, searchTerm),
    [corpus, searchTerm]
  );
  const { highlightIndex, matches } = findResult;
  const normalizedCurrentMatchIndex =
    matches.length > 0 ? currentMatchIndex % matches.length : 0;
  const currentMatch = matches[normalizedCurrentMatchIndex];
  const getTargetId = useCallback(
    (rowIndex: number, columnKey: string) =>
      findTargetId(
        viewKey,
        rowIndex,
        scrollTarget === "cell" ? columnKey : undefined
      ),
    [scrollTarget, viewKey]
  );

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [matches, setCurrentMatchIndex]);

  const goToNext = useCallback(() => {
    if (matches.length > 0) {
      setCurrentMatchIndex((current) => (current + 1) % matches.length);
    }
  }, [matches.length, setCurrentMatchIndex]);

  const goToPrevious = useCallback(() => {
    if (matches.length > 0) {
      setCurrentMatchIndex(
        (current) => (current - 1 + matches.length) % matches.length
      );
    }
  }, [matches.length, setCurrentMatchIndex]);

  const clear = useCallback(() => {
    setSearchTerm("");
  }, [setSearchTerm]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  useEffect(() => {
    if (!(active && currentMatch)) {
      return;
    }

    const targetId = getTargetId(currentMatch.rowIndex, currentMatch.columnKey);
    const animationFrame = requestAnimationFrame(() => {
      const root = rootRef.current;
      const target = document.getElementById(targetId);
      if (root && target && root.contains(target)) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [active, currentMatch, getTargetId, rootRef]);

  return useMemo(
    () => ({
      actions: { clear, goToNext, goToPrevious, setSearchTerm },
      meta: { getTargetId, inputRef },
      state: {
        currentMatch,
        currentMatchIndex: normalizedCurrentMatchIndex,
        highlightIndex,
        matches,
        searchTerm,
        total: matches.length,
      },
    }),
    [
      clear,
      currentMatch,
      goToNext,
      goToPrevious,
      getTargetId,
      highlightIndex,
      matches,
      normalizedCurrentMatchIndex,
      searchTerm,
      setSearchTerm,
    ]
  );
}

export const FindBar = {
  Bar: FindBarBar,
};
