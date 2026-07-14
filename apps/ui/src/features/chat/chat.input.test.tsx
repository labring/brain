import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChatDatabaseDeployButton,
  ChatDockerDeployButton,
  ChatGithubDeployButton,
  ChatSkillsWorkflowButton,
} from "./chat.input";

const noop = () => undefined;
const DOCKER_DEPLOY_ARIA_LABEL_RE = /aria-label="Docker deploy"/;
const NATIVE_TITLE_ATTR_RE = /\stitle="/;

test("chat composer deploy actions include GitHub, Docker, Database, and Skills controls in order", () => {
  const html = renderToStaticMarkup(
    <div>
      <ChatGithubDeployButton onComposerAction={noop} />
      <ChatDockerDeployButton onComposerAction={noop} />
      <ChatDatabaseDeployButton onComposerAction={noop} />
      <ChatSkillsWorkflowButton onComposerAction={noop} />
    </div>
  );

  const github = html.indexOf('data-slot="chat-github-deploy-button"');
  const docker = html.indexOf('data-slot="chat-docker-deploy-button"');
  const database = html.indexOf('data-slot="chat-database-deploy-button"');
  const skills = html.indexOf('data-slot="chat-skills-workflow-button"');

  assert.ok(github !== -1, "GitHub action is visible");
  assert.ok(docker !== -1, "Docker action is visible");
  assert.ok(database !== -1, "Database action is visible");
  assert.ok(skills !== -1, "Skills action is visible");
  assert.ok(github < docker, "GitHub appears before Docker");
  assert.ok(docker < database, "Docker appears before Database");
  assert.ok(database < skills, "Database appears before Skills");
  assert.match(html, DOCKER_DEPLOY_ARIA_LABEL_RE);
  assert.doesNotMatch(html, NATIVE_TITLE_ATTR_RE);
});
