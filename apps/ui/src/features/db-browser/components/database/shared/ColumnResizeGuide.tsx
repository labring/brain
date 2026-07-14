export function ColumnResizeGuide() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-50 w-px bg-primary/50"
      data-db-access-resize-guide=""
      style={{
        height: "var(--db-access-resize-guide-height, 0px)",
        left: "var(--db-access-resize-guide-left, 0px)",
        opacity: "var(--db-access-resize-guide-opacity, 0)",
        top: "var(--db-access-resize-guide-top, 0px)",
      }}
    />
  );
}
