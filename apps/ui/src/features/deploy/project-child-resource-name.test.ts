import assert from "node:assert/strict";
import { test } from "node:test";
import { childResourceName } from "./project-child-resource-name";

const DNS_1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const AP_FALLBACK_NAME = /^ap-[a-z]{6}$/;
const DB_FALLBACK_NAME = /^db-[a-z]{6}$/;
const NGINX_AP_NAME = /^nginx-[a-z]{6}$/;
const POSTGRESQL_DB_NAME = /^postgresql-[a-z]{6}$/;
const TEMPLATE_NAME_PREFIX = /^memos-[a-z]{6}$/;
const NORMALIZED_TEMPLATE_NAME =
  /^my-template-name-with-a-very-long-template-identifier-[a-z]{6}$/;
const MY_APP_IMAGE_NAME = /^my-app-image-[a-z]{6}$/;

test("ap and db names carry the slugified source prefix", () => {
  assert.match(childResourceName("nginx", "ap"), NGINX_AP_NAME);
  assert.match(childResourceName("PostgreSQL", "db"), POSTGRESQL_DB_NAME);
});

test("ap and db names stay DNS-1035 labels for unsafe sources", () => {
  const name = childResourceName("My_App.Image", "ap");

  assert.match(name, DNS_1035_LABEL);
  assert.match(name, MY_APP_IMAGE_NAME);
  assert.equal(name.length <= 63, true);
});

test("ap and db names fall back to the kind prefix without a source", () => {
  assert.match(childResourceName("", "ap"), AP_FALLBACK_NAME);
  assert.match(childResourceName("———", "db"), DB_FALLBACK_NAME);
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

test("resource names do not start with digits for UUID-like sources", () => {
  for (const kind of ["ap", "db", "template"] as const) {
    const name = childResourceName(
      "7512770d-fe30-4e65-adf2-ab5eaea1f67e",
      kind
    );

    assert.match(name, DNS_1035_LABEL);
    assert.equal(name.startsWith("app-7512770d"), true);
    assert.equal(name.length <= 63, true);
  }
});
