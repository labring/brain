/**
 * Shared interaction-state classes for app form controls.
 *
 * Focus and invalid express state the same way — a border-color change plus a
 * 1px ring — differing only in color (focus = blue, invalid = destructive).
 * Defined once so inputs, textareas, and hand-rolled field surfaces stop
 * copy-pasting divergent versions (focus rings had drifted to 1px while invalid
 * rings were still the stock shadcn 3px).
 *
 * Invalid wins over focus: every focus utility is gated with `not-aria-invalid:`
 * so a field that is both focused and invalid stays red instead of racing CSS
 * source order against the focus ring.
 *
 * Outliers whose "active" trigger isn't `:focus-visible` — the `AppSelect`
 * trigger (`data-[popup-open]`), the time-range trigger (`aria-expanded`), and
 * `focus-within` wrappers — keep their own strings; they match these blue values
 * by eye, not by import, because the variant prefix differs.
 */

/** Blue focus ring for controls that focus via `:focus-visible`. Gated so invalid wins. */
export const appFieldFocusClass =
  "not-aria-invalid:focus-visible:border-blue-400 not-aria-invalid:focus-visible:ring-[1px] not-aria-invalid:focus-visible:ring-blue-400/50";

/**
 * Destructive invalid ring for controls that toggle the `aria-invalid`
 * attribute (native inputs, textareas, Base UI fields).
 */
export const appFieldInvalidClass =
  "aria-invalid:border-destructive aria-invalid:ring-[1px] aria-invalid:ring-destructive/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

/**
 * Raw (unprefixed) destructive ring for surfaces that signal invalidity in JS
 * rather than through the `aria-invalid` attribute — e.g. a `div` wrapping a
 * code editor that can't carry the attribute. Apply conditionally:
 * `cn(base, invalid && fieldInvalidRingClass)`.
 */
export const fieldInvalidRingClass =
  "border-destructive ring-[1px] ring-destructive/50 dark:border-destructive/50 dark:ring-destructive/40";
