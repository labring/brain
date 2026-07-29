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

const N8N = {
  args: [
    {
      default: "false",
      description: "Use PostgreSQL",
      key: "use_postgresql",
      required: false,
      type: "boolean",
    },
    {
      default: "UTC",
      description: "Workflow timezone",
      key: "timezone",
      options: ["UTC", "Asia/Shanghai"],
      required: false,
      type: "choice",
    },
    {
      default: "",
      description: "Private API token",
      key: "api_token",
      options: ["private-default", "private-alternative"],
      required: true,
      type: "password",
    },
  ],
  description: "Workflow automation.",
  name: "n8n",
  title: "n8n",
} satisfies TemplateDeploymentChoice;

const COMBOBOX_ROLE_RE = /role="combobox"/;
const COMBOBOX_ROLES_RE = /role="combobox"/g;
const CHECKBOX_ROLE_RE = /role="checkbox"/;
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
const APP_SELECT_SOURCE_RE = /<AppSelect/;
const SEARCHABLE_SOURCE_RE = /searchable/;
const FALSE_RE = /false/;
const PASSWORD_INPUT_RE = /type="password"/;
const UTC_RE = /UTC/;
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

test("TemplateDeployer renders option, boolean, and sensitive controls", () => {
  const html = renderToStaticMarkup(
    <TemplateDeployer onDeploy={() => undefined} templateOptions={[N8N]} />
  );

  assert.equal([...html.matchAll(COMBOBOX_ROLES_RE)].length, 2);
  assert.match(html, CHECKBOX_ROLE_RE);
  assert.match(html, FALSE_RE);
  assert.match(html, UTC_RE);
  assert.match(html, PASSWORD_INPUT_RE);
  assert.ok(html.includes("Use PostgreSQL"));
  assert.ok(html.includes("Workflow timezone"));
});

test("TemplateDeployer renders empty state without combobox", () => {
  const html = renderToStaticMarkup(
    <TemplateDeployer emptyMessage="No templates" templateOptions={[]} />
  );

  assert.match(html, EMPTY_RE);
  assert.match(html, EMPTY_TEST_ID_RE);
  assert.doesNotMatch(html, COMBOBOX_ROLE_RE);
});

test("TemplateDeployer wires the template selector through a searchable AppSelect", () => {
  assert.match(SOURCE, APP_SELECT_SOURCE_RE);
  assert.match(SOURCE, SEARCHABLE_SOURCE_RE);
});
