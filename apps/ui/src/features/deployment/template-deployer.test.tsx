import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
const TEMPLATE_ICON_RE = /^https:\/\/example\.com\/dify\.png$/;
const IMAGE_SRC_RE = /src="([^"]+)"/;
const REQUIRED_ARG_RE = /init_password/;
const EMPTY_RE = /No templates/;
const DIFY_DESCRIPTION = "Dify is an open-source LLM app development platform.";
const ROOT_TEST_ID_RE = /data-testid="template\.deployer"/;
const COMBOBOX_TEST_ID_RE =
  /data-testid="template\.deployer\.template-combobox"/;
const PARAMETER_INPUT_TEST_ID_RE =
  /data-testid="template\.deployer\.parameter-input"/;
const PARAMETER_ARG_RE = /data-template-arg="init_password"/;
const SUBMIT_TEST_ID_RE = /data-testid="template\.deployer\.submit"/;
const EMPTY_TEST_ID_RE = /data-testid="template\.deployer\.empty"/;
const SEARCH_INPUT_SOURCE_RE = /data-testid="template\.deployer\.search-input"/;
const TEMPLATE_OPTION_SOURCE_RE =
  /data-testid="template\.deployer\.template-option"/;
const TEMPLATE_OPTION_NAME_SOURCE_RE = /data-template-name=\{choice\.name\}/;
const SOURCE = readFileSync(
  fileURLToPath(new URL("./template-deployer.tsx", import.meta.url))
).toString();

test("TemplateDeployer renders searchable template trigger with selected icon", () => {
  const html = renderToStaticMarkup(
    <TemplateDeployer
      onDeploy={() => undefined}
      templateOptions={TEMPLATE_OPTIONS}
    />
  );

  assert.match(html, COMBOBOX_ROLE_RE);
  assert.match(html, TEMPLATE_ARIA_RE);
  assert.match(html, ROOT_TEST_ID_RE);
  assert.match(html, COMBOBOX_TEST_ID_RE);
  assert.match(html, PARAMETER_INPUT_TEST_ID_RE);
  assert.match(html, PARAMETER_ARG_RE);
  assert.match(html, SUBMIT_TEST_ID_RE);
  assert.match(html, DIFY_RE);
  const imageSrc = IMAGE_SRC_RE.exec(html)?.[1] ?? "";
  assert.match(imageSrc, TEMPLATE_ICON_RE);
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
  assert.match(html, EMPTY_TEST_ID_RE);
  assert.doesNotMatch(html, COMBOBOX_ROLE_RE);
});

test("TemplateDeployer keeps runtime locators for opened template search", () => {
  assert.match(SOURCE, SEARCH_INPUT_SOURCE_RE);
  assert.match(SOURCE, TEMPLATE_OPTION_SOURCE_RE);
  assert.match(SOURCE, TEMPLATE_OPTION_NAME_SOURCE_RE);
});
