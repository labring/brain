/**
 * The one tint recipe billing state surfaces share — the Plan view's
 * subscription warning and the status hint banner alike: a soft background
 * wash with the semantic color on icon and title only, so the description
 * keeps its muted default.
 */
export type BillingSurfaceTone = "destructive" | "info" | "warning";

/** The semantic text pair alone, for inline warnings outside a washed surface. */
export const BILLING_TONE_TEXT: Record<BillingSurfaceTone, string> = {
  destructive: "text-destructive",
  info: "text-blue-600 dark:text-blue-400",
  warning: "text-amber-600 dark:text-amber-400",
};

export const BILLING_SURFACE_TONES: Record<BillingSurfaceTone, string> = {
  destructive: `bg-red-500/10 ${BILLING_TONE_TEXT.destructive}`,
  info: `bg-blue-400/10 ${BILLING_TONE_TEXT.info}`,
  warning: `bg-amber-400/10 ${BILLING_TONE_TEXT.warning}`,
};
