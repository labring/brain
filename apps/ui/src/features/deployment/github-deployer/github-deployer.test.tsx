import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { GithubDeployer, githubUrlToRepo } from "./github-deployer";

const noop = () => undefined;
const URL_INPUT_RE = /data-slot="github-deployer-url-input"/;
const URL_PLACEHOLDER_RE = /https:\/\/github.com\/owner\/repo/;
const URL_AUTH_REQUIRED_RE = /data-slot="github-deployer-url-auth-required"/;
const AUTH_BUTTON_RE = /aria-label="Connect workspace GitHub access"/;
const AUTHORIZED_RE = /data-slot="github-deployer-authorized"/;
const CONFIGURE_BUTTON_RE = /aria-label="Configure workspace GitHub access"/;
const DISCONNECT_BUTTON_RE = /aria-label="Disconnect GitHub"/;
const HEADER_TITLE_RE = /GitHub Import/;
const HEADER_SUBTITLE_RE =
  /Import from a repository URL or this workspace&#x27;s GitHub connection\./;
const REPOSITORY_URL_RE = /Repository URL/;
const WORKSPACE_GITHUB_RE = /Workspace GitHub/;
const REPOSITORY_SECTION_RE = /<h3[^>]*>Repository<\/h3>/;
const EXAMPLE_REPO_RE = /sealai\/example/;
const REPO_SELECT_RE = /data-slot="github-deployer-repo-select"/;
const REPO_CARD_RE = /data-slot="github-deployer-repo-card"/;
const PRIMARY_DEPLOY_BUTTON_RE =
  /<button[^>]*data-variant="primary"[^>]*>[\s\S]*?Deploy<\/button>/g;
const REPO_EMPTY_RE = /data-slot="github-deployer-repo-empty"/;
const REPO_ERROR_RE = /data-slot="github-deployer-repo-error"/;
const VIEW_MORE_RE = /data-slot="github-deployer-view-more"/;
const BAD_CREDENTIALS_RE = /bad credentials/;
const GITHUB_URL_LOCKED_RE =
  /Connect GitHub for this workspace before deploying from a repository URL\./;
const GITHUB_REPOSITORY_LOCKED_RE =
  /Connect GitHub for this workspace before selecting a repository\./;
const DISABLED_DEPLOY_RE =
  /data-slot="github-deployer-repo-card"[\s\S]*?<button[^>]*disabled=""/;

test("GithubDeployer asks for authorization before showing URL input", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onAuthorize: noop, onDeploy: noop }}
      states={{ isAuthorized: false, repos: [] }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, WORKSPACE_GITHUB_RE);
  assert.match(html, REPOSITORY_URL_RE);
  assert.doesNotMatch(html, HEADER_TITLE_RE);
  assert.doesNotMatch(html, HEADER_SUBTITLE_RE);
  assert.doesNotMatch(html, URL_INPUT_RE);
  assert.doesNotMatch(html, URL_PLACEHOLDER_RE);
  assert.doesNotMatch(html, URL_AUTH_REQUIRED_RE);
  assert.match(html, AUTH_BUTTON_RE);
  assert.doesNotMatch(html, REPO_SELECT_RE);
  assert.match(html, GITHUB_URL_LOCKED_RE);
  assert.match(html, GITHUB_REPOSITORY_LOCKED_RE);
});

test("GithubDeployer keeps URL input while showing authorized repo choices", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onAuthorize: noop, onDeploy: noop }}
      states={{
        isAuthorized: true,
        repos: [{ fullName: "sealai/example", id: "1", name: "example" }],
      }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, URL_INPUT_RE);
  assert.match(html, URL_PLACEHOLDER_RE);
  assert.match(html, REPOSITORY_URL_RE);
  assert.match(html, REPOSITORY_SECTION_RE);
  assert.doesNotMatch(html, URL_AUTH_REQUIRED_RE);
  assert.match(html, AUTHORIZED_RE);
  assert.match(html, CONFIGURE_BUTTON_RE);
  assert.match(html, DISCONNECT_BUTTON_RE);
  assert.match(html, REPO_SELECT_RE);
  assert.match(html, REPO_CARD_RE);
  assert.equal(html.match(PRIMARY_DEPLOY_BUTTON_RE)?.length, 2);
  assert.match(html, EXAMPLE_REPO_RE);
  assert.doesNotMatch(html, AUTH_BUTTON_RE);
  assert.doesNotMatch(html, REPO_EMPTY_RE);
});

test("GithubDeployer shows view more for long repository lists", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onAuthorize: noop, onDeploy: noop }}
      states={{
        isAuthorized: true,
        repos: Array.from({ length: 5 }, (_, index) => ({
          fullName: `sealai/example-${index + 1}`,
          id: String(index + 1),
          name: `example-${index + 1}`,
        })),
      }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, VIEW_MORE_RE);
});

test("GithubDeployer waits for template matching before repository deploy", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onDeploy: noop, onDeployTemplate: noop }}
      states={{
        isAuthorized: true,
        repos: [{ fullName: "sealai/example", id: "1", name: "example" }],
        templateOptionsLoading: true,
      }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, DISABLED_DEPLOY_RE);
});

test("githubUrlToRepo rejects GitHub URLs that are not repository roots", () => {
  assert.equal(
    githubUrlToRepo("https://github.com/sealai/example/tree/main"),
    null
  );
  assert.equal(
    githubUrlToRepo("https://github.com/sealai/example/blob/main/README.md"),
    null
  );
  assert.deepEqual(githubUrlToRepo("https://github.com/sealai/example.git"), {
    fullName: "sealai/example",
    id: "github-url:sealai/example",
    name: "example",
    url: "https://github.com/sealai/example",
  });
});

test("GithubDeployer shows authorized empty repository state", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onAuthorize: noop, onDeploy: noop }}
      states={{ isAuthorized: true, repos: [] }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, AUTHORIZED_RE);
  assert.match(html, CONFIGURE_BUTTON_RE);
  assert.match(html, REPO_EMPTY_RE);
  assert.doesNotMatch(html, AUTH_BUTTON_RE);
});

test("GithubDeployer shows repository load errors after authorization", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onAuthorize: noop, onDeploy: noop }}
      states={{
        isAuthorized: true,
        repoError: "bad credentials",
        repoRetry: noop,
        repos: [],
      }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, AUTHORIZED_RE);
  assert.match(html, CONFIGURE_BUTTON_RE);
  assert.match(html, REPO_ERROR_RE);
  assert.match(html, BAD_CREDENTIALS_RE);
  assert.doesNotMatch(html, AUTH_BUTTON_RE);
});
