"use client";

import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { memo } from "react";

import { registry } from "@/features/project-assistant/agui/registry";

/**
 * Renders catalog-backed json-render output from assistant tool calls.
 * Memoized as a second line of defense: the parent `ChatTool` already bails
 * per chunk (the SDK churns `output` references while a message streams, so
 * `spec` identity cannot be relied on — see `areChatToolPropsEqual`).
 */
export const ChatGenUIRenderer = memo(function ChatGenUIRenderer({
  spec,
}: {
  spec: Spec;
}) {
  return (
    <div
      className="json-render-chat-ui w-full min-w-0 rounded-lg border border-border bg-muted/30 p-3"
      data-slot="chat-gen-ui"
    >
      <JSONUIProvider registry={registry}>
        <Renderer registry={registry} spec={spec} />
      </JSONUIProvider>
    </div>
  );
});
