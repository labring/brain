import assert from "node:assert/strict";
import { test } from "node:test";

test("template catalog route does not force dynamic fetch caching", async () => {
  const templatesRoute = await import("./route");

  assert.equal(Object.hasOwn(templatesRoute, "dynamic"), false);
});
