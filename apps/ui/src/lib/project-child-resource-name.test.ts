import assert from "node:assert/strict";
import { test } from "node:test";
import { childResourceName } from "./project-child-resource-name";

const DNS_1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const AP_SHORT_NAME = /^ap-[a-z]{6}$/;
const DB_SHORT_NAME = /^db-[a-z]{6}$/;

test("child resource names do not include the project UUID", () => {
  const projectId = "1751df70-4807-4eca-ae3b-2da562345d9f";

  assert.match(childResourceName(projectId, "ap"), AP_SHORT_NAME);
  assert.match(childResourceName(projectId, "db"), DB_SHORT_NAME);
});

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
