import assert from "node:assert/strict";
import { test } from "node:test";

import { CHAT_TOOL_APPROVAL } from "./tool-approval";

test("chat approval policy applies to every tool by default", () => {
  assert.equal(typeof CHAT_TOOL_APPROVAL, "function");
  assert.equal(CHAT_TOOL_APPROVAL(), "not-applicable");
});
