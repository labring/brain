"use client";

import {
  SidePane,
  type SidePaneProps,
} from "@workspace/ui/components/side-pane";

export type CanvasResourcePaneProps = SidePaneProps;

export function CanvasResourcePane({
  closeAriaLabel = "Close resource pane",
  label = "Canvas resource pane",
  ...props
}: CanvasResourcePaneProps) {
  return <SidePane closeAriaLabel={closeAriaLabel} label={label} {...props} />;
}
