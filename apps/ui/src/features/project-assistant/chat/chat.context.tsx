"use client";

import type { ChatRootProps } from "./chat.types";

/** Layout shell only; compose `Header`, `Transcript`, and composer pieces with explicit props. */
export function ChatRoot({ children }: ChatRootProps) {
  return <>{children}</>;
}

ChatRoot.displayName = "Chat.Root";
