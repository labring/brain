import { useDbAccessViewState } from "@data-browser/state/db-access-view-state";
import { useStore } from "jotai";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

const DEFAULT_COLUMN_WIDTH = 120;
const MIN_COLUMN_WIDTH = 60;
const COLUMN_ELEMENT_SELECTOR = "[data-db-access-column]";
const RESIZE_HANDLE_SELECTOR = "[data-db-access-resize-handle]";

interface ColumnResizeOrigin {
  startWidth: number;
  startX: number;
}

interface UseColumnResizeParams {
  rootRef: RefObject<HTMLElement | null>;
  viewKey: string;
}

export function defaultColumnWidth(column: string): number {
  return Math.max(DEFAULT_COLUMN_WIDTH, column.length * 10 + 60);
}

export function columnWidthDuringResize(
  origin: ColumnResizeOrigin,
  clientX: number
): number {
  return Math.max(
    MIN_COLUMN_WIDTH,
    origin.startWidth + (clientX - origin.startX)
  );
}

function forColumnElements(
  root: HTMLElement,
  selector: string,
  datasetKey: "dbAccessColumn" | "dbAccessResizeHandle",
  column: string,
  visit: (element: HTMLElement) => void
) {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (element.dataset[datasetKey] === column) {
      visit(element);
    }
  }
}

function applyColumnWidth(root: HTMLElement, column: string, width: number) {
  forColumnElements(
    root,
    COLUMN_ELEMENT_SELECTOR,
    "dbAccessColumn",
    column,
    (element) => {
      element.style.minWidth = `${width}px`;
      element.style.maxWidth = `${width}px`;
    }
  );
}

function setResizeHandleActive(
  root: HTMLElement,
  column: string,
  active: boolean
) {
  forColumnElements(
    root,
    RESIZE_HANDLE_SELECTOR,
    "dbAccessResizeHandle",
    column,
    (element) => {
      if (active) {
        element.dataset.resizeActive = "";
      } else {
        delete element.dataset.resizeActive;
      }
    }
  );
}

/**
 * Keeps live resize coordinates in refs/DOM and commits the final width once.
 * Document listeners exist only while one resize gesture is active.
 */
export function useColumnResize({ rootRef, viewKey }: UseColumnResizeParams) {
  const store = useStore();
  const viewState = useDbAccessViewState(viewKey);
  const activeColumnRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    []
  );

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent, column: string) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      cleanupRef.current?.();

      const widthAtom = viewState.columnWidthAtom(column);
      const origin = {
        startWidth: store.get(widthAtom) ?? defaultColumnWidth(column),
        startX: event.clientX,
      } satisfies ColumnResizeOrigin;

      activeColumnRef.current = column;
      setResizeHandleActive(root, column, true);
      document.body.style.cursor = "col-resize";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        applyColumnWidth(
          root,
          column,
          columnWidthDuringResize(origin, moveEvent.clientX)
        );
      };

      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setResizeHandleActive(root, column, false);
        activeColumnRef.current = null;
        document.body.style.cursor = "default";
        if (cleanupRef.current === cleanup) {
          cleanupRef.current = null;
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        const finalWidth = columnWidthDuringResize(origin, upEvent.clientX);
        applyColumnWidth(root, column, finalWidth);
        store.set(widthAtom, finalWidth);
        cleanup();
      };

      cleanupRef.current = cleanup;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [rootRef, store, viewState]
  );

  const handleResizeHandleEnter = useCallback(
    (column: string) => {
      const root = rootRef.current;
      if (root && activeColumnRef.current === null) {
        setResizeHandleActive(root, column, true);
      }
    },
    [rootRef]
  );

  const handleResizeHandleLeave = useCallback(
    (column: string) => {
      const root = rootRef.current;
      if (root && activeColumnRef.current === null) {
        setResizeHandleActive(root, column, false);
      }
    },
    [rootRef]
  );

  return {
    handleResizeHandleEnter,
    handleResizeHandleLeave,
    handleResizeStart,
  };
}
