import assert from "node:assert/strict";
import { test } from "node:test";

import { isAssistantChatNamespaceReady } from "./project-assistant-chat-readiness";

test("assistant chat waits for a non-empty namespace before bootstrapping", () => {
  assert.equal(isAssistantChatNamespaceReady(""), false);
  assert.equal(isAssistantChatNamespaceReady("   "), false);
  assert.equal(isAssistantChatNamespaceReady("ns-demo"), true);
  assert.equal(isAssistantChatNamespaceReady(" ns-demo "), true);
});
