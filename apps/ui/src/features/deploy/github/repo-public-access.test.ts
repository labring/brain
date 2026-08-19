import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { checkGithubRepoPublicAccess } from "./repo-public-access";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(response: Response) {
  globalThis.fetch = (() =>
    Promise.resolve(response)) as unknown as typeof fetch;
}

test("reports a readable repository as publicly accessible", async () => {
  stubFetch(new Response("{}", { status: 200 }));
  assert.deepEqual(
    await checkGithubRepoPublicAccess({ fullName: "glpi-project/glpi" }),
    { accessible: true, checked: true }
  );
});

test("treats a 404 as a definitive private-or-missing answer", async () => {
  stubFetch(new Response("", { status: 404 }));
  assert.deepEqual(
    await checkGithubRepoPublicAccess({ fullName: "acme/private" }),
    { accessible: false, checked: true }
  );
});

test("treats a non-rate-limited 403 as a definitive refusal", async () => {
  stubFetch(
    new Response("", {
      headers: { "x-ratelimit-remaining": "42" },
      status: 403,
    })
  );
  assert.deepEqual(
    await checkGithubRepoPublicAccess({ fullName: "acme/blocked" }),
    { accessible: false, checked: true }
  );
});

test("fails open when the anonymous rate limit is exhausted", async () => {
  stubFetch(
    new Response("", {
      headers: { "x-ratelimit-remaining": "0" },
      status: 403,
    })
  );
  assert.deepEqual(
    await checkGithubRepoPublicAccess({ fullName: "glpi-project/glpi" }),
    { accessible: false, checked: false }
  );
});

test("fails open when GitHub is unreachable", async () => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("network down"))) as unknown as typeof fetch;
  assert.deepEqual(
    await checkGithubRepoPublicAccess({ fullName: "glpi-project/glpi" }),
    { accessible: false, checked: false }
  );
});

test("fails open on an upstream GitHub error", async () => {
  stubFetch(new Response("", { status: 500 }));
  assert.deepEqual(
    await checkGithubRepoPublicAccess({ fullName: "glpi-project/glpi" }),
    { accessible: false, checked: false }
  );
});
