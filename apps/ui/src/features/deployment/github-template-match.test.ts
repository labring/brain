import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultTemplateArgs,
  findTemplateForGithubRepo,
  normalizeGithubRepoReference,
  templateCanDeployWithDefaults,
} from "./github-template-match";

test("normalizeGithubRepoReference accepts common GitHub URL forms", () => {
  assert.equal(
    normalizeGithubRepoReference("https://github.com/Acme/Web.git"),
    "acme/web"
  );
  assert.equal(
    normalizeGithubRepoReference("git@github.com:Acme/Web.git"),
    "acme/web"
  );
  assert.equal(normalizeGithubRepoReference("Acme/Web"), "acme/web");
  assert.equal(
    normalizeGithubRepoReference("https://example.com/acme/web"),
    null
  );
});

test("findTemplateForGithubRepo matches only explicit source repo metadata", () => {
  const match = findTemplateForGithubRepo({
    repo: {
      fullName: "acme/web",
      id: "repo-1",
      name: "web",
      url: "https://github.com/acme/web",
    },
    templates: [
      {
        args: [],
        description: "Wrong title match should not count",
        name: "web",
        sourceRepos: [],
        title: "acme/web",
      },
      {
        args: [],
        description: "Official template",
        name: "web-template",
        sourceRepos: ["https://github.com/acme/web.git"],
        title: "Web Template",
      },
    ],
  });

  assert.equal(match?.name, "web-template");
});

test("templateCanDeployWithDefaults requires defaults for required args", () => {
  assert.equal(
    templateCanDeployWithDefaults({
      args: [
        {
          default: "Asia/Shanghai",
          description: "",
          key: "tz",
          required: true,
          type: "string",
        },
      ],
      description: "",
      name: "n8n",
      title: "n8n",
    }),
    true
  );
  assert.equal(
    templateCanDeployWithDefaults({
      args: [
        {
          description: "",
          key: "password",
          required: true,
          type: "string",
        },
      ],
      description: "",
      name: "n8n",
      title: "n8n",
    }),
    false
  );
});

test("defaultTemplateArgs returns provider defaults", () => {
  assert.deepEqual(
    defaultTemplateArgs({
      args: [
        {
          default: "5",
          description: "",
          key: "storage",
          required: true,
          type: "number",
        },
        {
          description: "",
          key: "optional",
          required: false,
          type: "string",
        },
      ],
      description: "",
      name: "memos",
      title: "memos",
    }),
    { optional: "", storage: "5" }
  );
});
