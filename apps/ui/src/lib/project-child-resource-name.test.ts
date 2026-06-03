import assert from "node:assert/strict";
import { test } from "node:test";
import { childResourceName } from "./project-child-resource-name";

const DNS_1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

test("childResourceName creates DNS-1035 names for UUID project ids", () => {
  const name = childResourceName("4ebacadd-d705-493f-9302-c4c54e51fb61", "ap");

  assert.match(name, DNS_1035_LABEL);
  assert.equal(name.startsWith("ap-"), true);
  assert.equal(name.length <= 63, true);
});

test("childResourceName uses resource kind prefixes", () => {
  assert.equal(childResourceName("project-a", "ap").startsWith("ap-"), true);
  assert.equal(childResourceName("project-a", "db").startsWith("db-"), true);
});
