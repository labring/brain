import assert from "node:assert/strict";
import { test } from "node:test";
import { childResourceName } from "./project-child-resource-name";

const DNS_1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const AP_SHORT_NAME = /^ap-[a-z]{6}$/;
const DB_SHORT_NAME = /^db-[a-z]{6}$/;
const TEMPLATE_NAME_PREFIX = /^memos-[a-z]{6}$/;
const NORMALIZED_TEMPLATE_NAME =
  /^my-template-name-with-a-very-long-template-identifier-[a-z]{6}$/;

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

test("template resource names use the template name as prefix", () => {
  assert.match(childResourceName("memos", "template"), TEMPLATE_NAME_PREFIX);
});

test("template resource names normalize unsafe template names", () => {
  const name = childResourceName(
    "My_Template.Name_With_A_Very_Long_Template_Identifier",
    "template"
  );

  assert.match(name, DNS_1035_LABEL);
  assert.equal(name.length <= 63, true);
  assert.match(name, NORMALIZED_TEMPLATE_NAME);
});

test("template resource names do not start with digits for UUID-like names", () => {
  const name = childResourceName(
    "7512770d-fe30-4e65-adf2-ab5eaea1f67e",
    "template"
  );

  assert.match(name, DNS_1035_LABEL);
  assert.equal(name.startsWith("app-7512770d"), true);
  assert.equal(name.length <= 63, true);
});
