import type { useColumnResize } from "./useColumnResize";

export function ColumnResizeHandle({
  column,
  columnIndex,
  resize,
}: {
  column: string;
  columnIndex: number;
  resize: ReturnType<typeof useColumnResize>;
}) {
  return (
    <div
      className="absolute top-0 right-0 -bottom-px z-20 w-1 cursor-col-resize"
      data-db-access-resize-handle={column}
      onLostPointerCapture={resize.handleResizeCancel}
      onPointerCancel={resize.handleResizeCancel}
      onPointerDown={(event) =>
        resize.handleResizeStart(event, column, columnIndex)
      }
      onPointerEnter={resize.handleResizeHandleEnter}
      onPointerLeave={resize.handleResizeHandleLeave}
      onPointerMove={resize.handleResizeMove}
      onPointerUp={resize.handleResizeFinish}
    />
  );
}
