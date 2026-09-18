/**
 * A dialog running a write keeps its shape until the write answers: Cancel
 * is disabled, and Escape or the overlay are ignored the same way, so the
 * outcome always lands in a mounted dialog.
 */
export function closeUnlessPending(
  onOpenChange: (open: boolean) => void,
  pending: boolean
): (open: boolean) => void {
  return (open) => {
    if (open || !pending) {
      onOpenChange(open);
    }
  };
}
