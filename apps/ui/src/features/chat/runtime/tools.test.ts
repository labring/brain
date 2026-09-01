import assert from "node:assert/strict";
import { test } from "node:test";

import { CHAT_TOOL_APPROVAL } from "./tool-approval";

test("raw Devbox mutation tools require user approval", () => {
  assert.deepEqual(CHAT_TOOL_APPROVAL, {
    bash: "user-approval",
    edit: "user-approval",
    write: "user-approval",
  });
  assert.equal(Reflect.has(CHAT_TOOL_APPROVAL, "read"), false);
});
