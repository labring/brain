import { useDbAccessViewState } from "@data-browser/state/db-access-view-state";
import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { FindBarBar } from "./FindBar.Bar";

export interface FindMatch {
  columnKey: string;
  rowIndex: number;
}

export interface FindBarModel {
  actions: {
    clear: () => void;
    goToNext: () => void;
    goToPrevious: () => void;
    setSearchTerm: (term: string) => void;
  };
  meta: {
    inputRef: RefObject<HTMLInputElement | null>;
  };
  state: {
    currentMatchIndex: number;
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
  viewKey: string;
}

export function findMatches(
  rows: Record<string, unknown>[] | undefined,
  columns: string[] | undefined,
  searchTerm: string
): FindMatch[] {
  if (!(searchTerm.trim() && rows && columns)) {
    return [];
  }

  const term = searchTerm.toLowerCase();
  const matches: FindMatch[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) {
      continue;
    }
    for (const columnKey of columns) {
      const value = row[columnKey];
      if (value != null && String(value).toLowerCase().includes(term)) {
        matches.push({ columnKey, rowIndex });
      }
    }
  }
  return matches;
}

export function useFindInView({
  active,
  columns,
  rootRef,
  rows,
  viewKey,
}: UseFindInViewParams): FindBarModel {
  const viewState = useDbAccessViewState(viewKey);
  const searchTerm = useAtomValue(viewState.findTermAtom);
  const currentMatchIndex = useAtomValue(viewState.currentFindMatchAtom);
  const setSearchTerm = useSetAtom(viewState.setFindTermAtom);
  const setCurrentMatchIndex = useSetAtom(viewState.currentFindMatchAtom);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(
    () => findMatches(rows, columns, searchTerm),
    [columns, rows, searchTerm]
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
    if (!(active && matches.length > 0)) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>('[data-find-current="true"]')
        ?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [active, currentMatchIndex, matches, rootRef]);

  return useMemo(
    () => ({
      actions: { clear, goToNext, goToPrevious, setSearchTerm },
      meta: { inputRef },
      state: {
        currentMatchIndex,
        matches,
        searchTerm,
        total: matches.length,
      },
    }),
    [
      clear,
      currentMatchIndex,
      goToNext,
      goToPrevious,
      matches,
      searchTerm,
      setSearchTerm,
    ]
  );
}

export const FindBar = {
  Bar: FindBarBar,
};
