"use client";

import {
  SidePane,
  SidePanePresence,
  type SidePaneProps,
} from "@workspace/ui/components/side-pane";
import type { ReactNode } from "react";

export type CanvasResourcePaneProps = SidePaneProps;

export function CanvasResourcePane({
  closeAriaLabel = "Close resource pane",
  label = "Canvas resource pane",
  ...props
}: CanvasResourcePaneProps) {
  return <SidePane closeAriaLabel={closeAriaLabel} label={label} {...props} />;
}

export function CanvasResourcePanePresence({
  children,
}: {
  children: ReactNode;
}) {
  return <SidePanePresence>{children}</SidePanePresence>;
}
