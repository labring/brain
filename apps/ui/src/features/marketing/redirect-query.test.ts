import assert from "node:assert/strict";
import { test } from "node:test";
import { appendMarketingRedirectQuery } from "./redirect-query";

test("root redirect retains encoded attribution and consent proof", () => {
  const query = { sea_attr: "eyJ2ZXJzaW9uIjoyfQ", consent_token: "a+b/c=" };
  const url = new URL(
    appendMarketingRedirectQuery("/project", query),
    "https://brain.test"
  );
  assert.equal(url.pathname, "/project");
  assert.equal(url.searchParams.get("sea_attr"), query.sea_attr);
  assert.equal(url.searchParams.get("consent_token"), query.consent_token);
});

test("deployment redirect retains side intent and excludes credentials", () => {
  const url = new URL(
    appendMarketingRedirectQuery("/project?side=template#creation", {
      sea_attr: "encoded",
      consent_token: "proof",
      token: "secret",
      kubeconfig: "secret",
    }),
    "https://brain.test"
  );
  assert.equal(url.searchParams.get("side"), "template");
  assert.equal(url.searchParams.get("sea_attr"), "encoded");
  assert.equal(url.searchParams.get("token"), null);
  assert.equal(url.searchParams.get("kubeconfig"), null);
  assert.equal(url.hash, "#creation");
});

test("ambiguous and empty inbound parameters do not replace valid intent", () => {
  assert.equal(
    appendMarketingRedirectQuery("/project?side=github", {
      sea_attr: ["first", "second"],
      consent_token: "   ",
    }),
    "/project?side=github"
  );
});
