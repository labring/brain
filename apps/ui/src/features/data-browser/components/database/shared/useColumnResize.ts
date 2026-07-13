import { usePointerResizeGesture } from "@data-browser/components/shared/usePointerResizeGesture";
import { useDbAccessViewState } from "@data-browser/state/db-access-view-state";
import { useStore } from "jotai";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
} from "react";

const DEFAULT_COLUMN_WIDTH = 120;
const MIN_COLUMN_WIDTH = 60;
const GRID_SCROLL_SELECTOR = "[data-db-access-grid-scroll]";
const GUIDE_LEFT_PROPERTY = "--db-access-resize-guide-left";
const GUIDE_TOP_PROPERTY = "--db-access-resize-guide-top";
const GUIDE_HEIGHT_PROPERTY = "--db-access-resize-guide-height";
const GUIDE_OPACITY_PROPERTY = "--db-access-resize-guide-opacity";

interface ColumnResizeOrigin {
  startWidth: number;
  startX: number;
}

interface UseColumnResizeParams {
  rootRef: RefObject<HTMLElement | null>;
  viewKey: string;
}

type CustomPropertyStyle = CSSProperties & Record<`--${string}`, string>;

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

export function columnResizePreview(
  origin: ColumnResizeOrigin,
  startBoundaryClientX: number,
  clientX: number
) {
  const width = columnWidthDuringResize(origin, clientX);
  return {
    boundaryClientX: startBoundaryClientX + (width - origin.startWidth),
    width,
  };
}

export function columnWidthCssProperty(columnIndex: number): `--${string}` {
  return `--db-access-column-${columnIndex}-width`;
}

export function columnWidthStyle(
  column: string,
  columnIndex: number
): CSSProperties {
  const property = columnWidthCssProperty(columnIndex);
  return {
    maxWidth: `var(${property}, none)`,
    minWidth: `var(${property}, ${defaultColumnWidth(column)}px)`,
  };
}

export function columnWidthRootStyle(
  columns: readonly string[],
  getCommittedWidth: (column: string) => number | null
): CSSProperties {
  const style: CustomPropertyStyle = {};
  for (const [columnIndex, column] of columns.entries()) {
    const width = getCommittedWidth(column) ?? defaultColumnWidth(column);
    style[columnWidthCssProperty(columnIndex)] = `${width}px`;
  }
  return style;
}

function setGuideGeometry(
  root: HTMLElement,
  handle: HTMLElement,
  clientX = handle.getBoundingClientRect().right
) {
  const grid = handle.closest<HTMLElement>(GRID_SCROLL_SELECTOR);
  if (!grid) {
    return;
  }

  const rootRect = root.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  root.style.setProperty(GUIDE_LEFT_PROPERTY, `${clientX - rootRect.left}px`);
  root.style.setProperty(
    GUIDE_TOP_PROPERTY,
    `${gridRect.top - rootRect.top}px`
  );
  root.style.setProperty(GUIDE_HEIGHT_PROPERTY, `${gridRect.height}px`);
  root.style.setProperty(GUIDE_OPACITY_PROPERTY, "1");
}

function hideGuide(root: HTMLElement) {
  root.style.setProperty(GUIDE_OPACITY_PROPERTY, "0");
}

/**
 * Owns one live CSS width per visible column and commits only the final width.
 * Every cell edge remains a resize target without subscribing every cell to Jotai.
 */
export function useColumnResize({ rootRef, viewKey }: UseColumnResizeParams) {
  const store = useStore();
  const viewState = useDbAccessViewState(viewKey);
  const activeColumnIndexRef = useRef<number | null>(null);
  const pointerResize = usePointerResizeGesture();

  const getRootStyle = useCallback(
    (columns: string[]): CSSProperties =>
      columnWidthRootStyle(columns, (column) =>
        store.get(viewState.columnWidthAtom(column))
      ),
    [store, viewState]
  );

  const handleResizeStart = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      column: string,
      columnIndex: number
    ) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      event.stopPropagation();
      const handle = event.currentTarget;
      const startBoundaryClientX = handle.getBoundingClientRect().right;
      const widthAtom = viewState.columnWidthAtom(column);
      const property = columnWidthCssProperty(columnIndex);
      const origin = {
        startWidth: store.get(widthAtom) ?? defaultColumnWidth(column),
        startX: event.clientX,
      } satisfies ColumnResizeOrigin;

      pointerResize.start(event, {
        cancel: () => {
          root.style.setProperty(property, `${origin.startWidth}px`);
          activeColumnIndexRef.current = null;
          hideGuide(root);
        },
        commit: (clientX) => {
          store.set(widthAtom, columnWidthDuringResize(origin, clientX));
          activeColumnIndexRef.current = null;
          hideGuide(root);
        },
        preview: (clientX) => {
          const preview = columnResizePreview(
            origin,
            startBoundaryClientX,
            clientX
          );
          root.style.setProperty(property, `${preview.width}px`);
          setGuideGeometry(root, handle, preview.boundaryClientX);
        },
      });
      activeColumnIndexRef.current = columnIndex;
      setGuideGeometry(root, handle, startBoundaryClientX);
    },
    [pointerResize, rootRef, store, viewState]
  );

  const handleResizeHandleEnter = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const root = rootRef.current;
      if (root && activeColumnIndexRef.current === null) {
        setGuideGeometry(root, event.currentTarget);
      }
    },
    [rootRef]
  );

  const handleResizeHandleLeave = useCallback(() => {
    const root = rootRef.current;
    if (root && activeColumnIndexRef.current === null) {
      hideGuide(root);
    }
  }, [rootRef]);

  return {
    getRootStyle,
    handleResizeCancel: pointerResize.cancel,
    handleResizeFinish: pointerResize.finish,
    handleResizeHandleEnter,
    handleResizeHandleLeave,
    handleResizeMove: pointerResize.move,
    handleResizeStart,
  };
}
