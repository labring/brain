/**
 * Shared frosted popup surface for dropdown-style popups.
 *
 * Defined once so the Base UI Combobox popups behind `AppSelect`/`AppMultiSelect`
 * and the `DropdownMenu`-based popups that want the same look (e.g. the chat
 * thread-history switcher) stay visually in sync instead of each copy-pasting the
 * `bg-input/30 backdrop-blur-xl` panel. Surface only — item/row highlight stays
 * per-component because the primitives expose different state data-attributes.
 */
export const popoverSurfaceClass =
  "rounded-md border border-border bg-input/30 shadow-none ring-0 backdrop-blur-xl";
