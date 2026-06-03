import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDbPublicAccessMergePatch } from "./db-public-access-patch";

test("DB public access patch adds routing domain when enabling without region label", () => {
  assert.deepEqual(
    buildDbPublicAccessMergePatch(true, {
      metadata: { labels: { "brain.io/project-id": "project" } },
      routingDomain: "192.168.12.53.nip.io",
    }),
    {
      metadata: { labels: { region: "192.168.12.53.nip.io" } },
      spec: { exposeNodePort: true },
    }
  );
});

test("DB public access patch preserves existing region label", () => {
  assert.deepEqual(
    buildDbPublicAccessMergePatch(true, {
      metadata: { labels: { region: "custom.example.com" } },
      routingDomain: "192.168.12.53.nip.io",
    }),
    {
      spec: { exposeNodePort: true },
    }
  );
});

test("DB public access patch does not add region when disabling", () => {
  assert.deepEqual(
    buildDbPublicAccessMergePatch(false, {
      routingDomain: "192.168.12.53.nip.io",
    }),
    {
      spec: { exposeNodePort: false },
    }
  );
});
