import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { GithubDeployer } from "./github-deployer";

const noop = () => undefined;
const URL_INPUT_RE = /data-slot="github-deployer-url-input"/;
const URL_PLACEHOLDER_RE = /https:\/\/github.com\/owner\/repo/;
const AUTH_BUTTON_RE = /aria-label="Authorize GitHub"/;
const AUTHORIZED_RE = /data-slot="github-deployer-authorized"/;
const DISCONNECT_BUTTON_RE = /aria-label="Disconnect GitHub"/;
const HEADER_TITLE_RE = /GitHub Import/;
const HEADER_SUBTITLE_RE =
  /Import repository from URL or GitHub authorization\./;
const REPOSITORY_URL_RE = /Repository URL/;
const GITHUB_ACCOUNT_RE = /GitHub Account/;
const EXAMPLE_REPO_RE = /sealai\/example/;
const REPO_SELECT_RE = /data-slot="github-deployer-repo-select"/;
const REPO_CARD_RE = /data-slot="github-deployer-repo-card"/;
const REPO_EMPTY_RE = /data-slot="github-deployer-repo-empty"/;
const REPO_ERROR_RE = /data-slot="github-deployer-repo-error"/;
const VIEW_MORE_RE = /data-slot="github-deployer-view-more"/;
const BAD_CREDENTIALS_RE = /bad credentials/;

test("GithubDeployer shows URL input and authorization when unauthenticated", () => {
  const html = renderToStaticMarkup(
    <GithubDeployer.Root
      actions={{ onAuthorize: noop, onDeploy: noop }}
      states={{ isAuthorized: false, repos: [] }}
    >
      <GithubDeployer.Shell />
    </GithubDeployer.Root>
  );

  assert.match(html, REPOSITORY_URL_RE);
  assert.match(html, GITHUB_ACCOUNT_RE);
  assert.doesNotMatch(html, HEADER_TITLE_RE);
  assert.doesNotMatch(html, HEADER_SUBTITLE_RE);
  assert.match(html, URL_INPUT_RE);
  assert.match(html, URL_PLACEHOLDER_RE);
  assert.match(html, AUTH_BUTTON_RE);
  assert.doesNotMatch(html, REPO_SELECT_RE);
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
  assert.match(html, AUTHORIZED_RE);
  assert.match(html, DISCONNECT_BUTTON_RE);
  assert.match(html, REPO_SELECT_RE);
  assert.match(html, REPO_CARD_RE);
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
  assert.match(html, REPO_ERROR_RE);
  assert.match(html, BAD_CREDENTIALS_RE);
  assert.doesNotMatch(html, AUTH_BUTTON_RE);
});
