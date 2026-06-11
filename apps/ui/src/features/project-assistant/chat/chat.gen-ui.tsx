"use client";

import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";

import { registry } from "@/features/project-assistant/agui/registry";

/** Renders catalog-backed json-render output from assistant tool calls. */
export function ChatGenUIRenderer({ spec }: { spec: Spec }) {
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
}
