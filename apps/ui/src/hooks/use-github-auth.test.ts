import assert from "node:assert/strict";
import { test } from "node:test";

import { GITHUB_APP_INSTALL_COMPLETE_MESSAGE } from "../lib/github-app/types";
import { githubInstallReturnPathForNavigation } from "./use-github-auth";

test("githubInstallReturnPathForNavigation only applies targeted return paths", () => {
  const message = {
    returnPath: "/projects?source=github",
    state: "install-state",
    type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
  };

  assert.equal(
    githubInstallReturnPathForNavigation(message, { applyReturnPath: true }),
    "/projects?source=github"
  );
  assert.equal(githubInstallReturnPathForNavigation(message), null);
  assert.equal(
    githubInstallReturnPathForNavigation(message, { applyReturnPath: false }),
    null
  );
});

test("githubInstallReturnPathForNavigation rejects malformed completion messages", () => {
  assert.equal(
    githubInstallReturnPathForNavigation(
      {
        returnPath: "https://example.com/projects",
        state: "install-state",
        type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
      },
      { applyReturnPath: true }
    ),
    null
  );
  assert.equal(
    githubInstallReturnPathForNavigation(
      {
        returnPath: "/projects",
        state: "install-state",
        type: "other-message",
      },
      { applyReturnPath: true }
    ),
    null
  );
  assert.equal(
    githubInstallReturnPathForNavigation(
      {
        returnPath: "/projects",
        type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
      },
      { applyReturnPath: true }
    ),
    null
  );
});
