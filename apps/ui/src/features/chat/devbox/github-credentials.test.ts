import { mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
let oauthTokens: (string | null)[] = [];
mock.module("@/features/deploy/github/connection-service", () => ({
  getGithubOAuthTokenForOwner: () =>
    Promise.resolve(oauthTokens.shift() ?? null),
}));
mock.module("@/features/deploy/github/owner-identity", () => ({
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION: 2,
}));

const {
  buildChatGithubProfile,
  redactChatGithubToken,
  syncChatGithubCredentials,
  wrapChatGithubCommand,
} = await import("./github-credentials");

test("not-connected profile clears inherited GitHub credentials", () => {
  const profile = buildChatGithubProfile(null);

  assert.ok(profile.includes("unset GH_TOKEN"));
  assert.ok(profile.includes("unset GITHUB_TOKEN"));
  assert.ok(profile.includes("SEALAI_GITHUB_STATUS=not-connected"));
  assert.ok(!profile.includes("gh auth setup-git"));
});

test("connected profile exports GH_TOKEN and configures git", () => {
  const profile = buildChatGithubProfile("github_pat_secret");

  assert.ok(profile.includes("unset GITHUB_TOKEN"));
  assert.ok(profile.includes("GH_TOKEN='github_pat_secret'"));
  assert.ok(profile.includes("SEALAI_GITHUB_STATUS=connected"));
  assert.ok(profile.includes("gh auth setup-git"));
});

test("command wrapper emits stable GitHub diagnostics", () => {
  const command = wrapChatGithubCommand("gh repo view");

  assert.ok(command.includes("[github_not_connected]"));
  assert.ok(command.includes("[github_cli_unavailable]"));
  assert.ok(command.includes("[github_credentials_rejected]"));
  assert.ok(command.includes("gh repo view"));
});

test("token redaction covers exact and recognizable GitHub tokens", () => {
  const output = redactChatGithubToken(
    "exact=secret github_pat_11ABC_def ghp_123456",
    "secret"
  );

  assert.equal(
    output,
    "exact=[REDACTED_GITHUB_TOKEN] [REDACTED_GITHUB_TOKEN] [REDACTED_GITHUB_TOKEN]"
  );
});

test("sync clears a profile when disconnect fences the token after lookup", async () => {
  oauthTokens = ["old-token", null];
  const profiles: string[] = [];

  const result = await syncChatGithubCredentials({
    namespace: "ns",
    workspaceUserUid: "user",
    writeProfile: (content) => {
      profiles.push(content);
      return Promise.resolve();
    },
  });

  assert.equal(result.status, "not-connected");
  assert.equal(result.token, null);
  assert.equal(profiles.length, 2);
  assert.ok(profiles[0]?.includes("GH_TOKEN='old-token'"));
  assert.ok(profiles[1]?.includes("SEALAI_GITHUB_STATUS=not-connected"));
});

test("sync keeps a reauthorization that replaces the fenced token", async () => {
  oauthTokens = ["old-token", "new-token"];
  const profiles: string[] = [];

  const result = await syncChatGithubCredentials({
    namespace: "ns",
    workspaceUserUid: "user",
    writeProfile: (content) => {
      profiles.push(content);
      return Promise.resolve();
    },
  });

  assert.equal(result.status, "connected");
  assert.equal(result.token, "new-token");
  assert.equal(profiles.length, 2);
  assert.ok(profiles[1]?.includes("GH_TOKEN='new-token'"));
});
