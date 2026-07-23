import assert from "node:assert/strict";
import { test } from "node:test";

import {
  navigateAppOutputSchema,
  navigateAppTool,
} from "./chat-navigate-app-tool";

test("navigate app exposes a bounded strict output contract", () => {
  assert.deepEqual(
    navigateAppOutputSchema.parse({
      path: "/project/example",
      success: true,
    }),
    {
      path: "/project/example",
      success: true,
    }
  );
  assert.equal(
    navigateAppOutputSchema.safeParse({
      extra: true,
      path: "/project/example",
      success: true,
    }).success,
    false
  );
  assert.equal(
    navigateAppOutputSchema.safeParse({
      error: "x".repeat(501),
      success: false,
    }).success,
    false
  );
  assert.equal(
    Reflect.get(navigateAppTool, "outputSchema"),
    navigateAppOutputSchema
  );
});
