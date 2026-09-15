import assert from "node:assert/strict";
import { test } from "node:test";

import { workspaceInviteUrl } from "./workspace-invite-core";

// Spec §B.2: the link has Desktop's own shape, `/WorkspaceInvite/?code=`,
// on the Desktop origin the SDK (or the kubeconfig) names.
test("the invite link is Desktop's landing page on the cloud domain with the code", () => {
  assert.equal(
    workspaceInviteUrl({ cloudDomain: "cloud.sealos.io", code: "abc-123" }),
    "https://cloud.sealos.io/WorkspaceInvite/?code=abc-123"
  );
  assert.equal(
    workspaceInviteUrl({
      cloudDomain: "https://desktop.staging.test/",
      code: "x y",
    }),
    "https://desktop.staging.test/WorkspaceInvite/?code=x%20y"
  );
});

test("no link without a domain or a code", () => {
  assert.equal(workspaceInviteUrl({ cloudDomain: "  ", code: "abc" }), null);
  assert.equal(
    workspaceInviteUrl({ cloudDomain: "cloud.test", code: " " }),
    null
  );
});
