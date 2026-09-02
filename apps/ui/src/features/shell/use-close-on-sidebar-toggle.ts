import { useState } from "react";

/**
 * Closes a sidebar-anchored popover when the App Sidebar toggles between
 * Expanded and Collapsed. The toggle moves the popover's anchor, so closing
 * beats letting an open popover chase the 200ms width transition.
 *
 * Render-phase state adjustment (the React "adjusting state when a prop
 * changes" pattern), so `close` must only update this component's own state.
 */
export function useCloseOnSidebarToggle(expanded: boolean, close: () => void) {
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if (prevExpanded !== expanded) {
    setPrevExpanded(expanded);
    close();
  }
}
