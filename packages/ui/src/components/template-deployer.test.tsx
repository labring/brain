import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TemplateDeployer,
  type TemplateDeploymentChoice,
} from "./template-deployer";

const TEMPLATE_OPTIONS = [
  {
    args: [
      {
        default: "",
        description: "admin init password",
        key: "init_password",
        required: true,
        type: "string",
      },
    ],
    description: "Dify is an open-source LLM app development platform.",
    icon: "https://example.com/dify.png",
    name: "dify",
    title: "dify",
  },
  {
    args: [],
    description: "Database admin UI.",
    name: "pgadmin4",
    title: "pgadmin4",
  },
] satisfies readonly TemplateDeploymentChoice[];

const COMBOBOX_ROLE_RE = /role="combobox"/;
const TEMPLATE_ARIA_RE = /aria-label="Template"/;
const DIFY_RE = /dify/;
const TEMPLATE_ICON_RE = /https:\/\/example.com\/dify\.png/;
const REQUIRED_ARG_RE = /init_password/;
const EMPTY_RE = /No templates/;
const DIFY_DESCRIPTION = "Dify is an open-source LLM app development platform.";

test("TemplateDeployer renders searchable template trigger with selected icon", () => {
  const html = renderToStaticMarkup(
    <TemplateDeployer
      onDeploy={() => undefined}
      templateOptions={TEMPLATE_OPTIONS}
    />
  );

  assert.match(html, COMBOBOX_ROLE_RE);
  assert.match(html, TEMPLATE_ARIA_RE);
  assert.match(html, DIFY_RE);
  assert.match(html, TEMPLATE_ICON_RE);
  assert.match(html, REQUIRED_ARG_RE);
  assert.ok(
    html.indexOf('role="combobox"') < html.indexOf(DIFY_DESCRIPTION),
    "template description should render after the template selector"
  );
});

test("TemplateDeployer renders empty state without combobox", () => {
  const html = renderToStaticMarkup(
    <TemplateDeployer emptyMessage="No templates" templateOptions={[]} />
  );

  assert.match(html, EMPTY_RE);
  assert.doesNotMatch(html, COMBOBOX_ROLE_RE);
});
