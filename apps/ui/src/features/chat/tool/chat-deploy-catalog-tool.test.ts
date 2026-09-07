import assert from "node:assert/strict";
import { test } from "node:test";

import type { TemplateCatalogItem } from "@/features/deploy/template-provider-core";

import {
  createSearchDeployCatalogTool,
  DEPLOY_CATALOG_UNAVAILABLE_ERROR,
  rankDeployCatalog,
  scoreTemplateForQuery,
} from "./chat-deploy-catalog-tool";

function template(
  overrides: Partial<TemplateCatalogItem> & { name: string }
): TemplateCatalogItem {
  return {
    args: [],
    category: [],
    description: "",
    icon: "",
    readme: "",
    sourceRepos: [],
    title: overrides.name,
    ...overrides,
  };
}

const glpi = template({
  args: [
    {
      description: "Required initial GLPI Super-Admin password.",
      key: "admin_password",
      required: true,
      type: "string",
    },
  ],
  category: ["tool", "dev-ops"],
  description: "GLPI is an open source IT asset management and service desk.",
  name: "glpi",
  sourceRepos: ["https://github.com/glpi-project/glpi"],
  title: "GLPI",
});

const affine = template({
  category: ["tool"],
  description: "A workspace with fully merged docs, whiteboards and databases.",
  name: "affine",
  sourceRepos: ["https://github.com/toeverything/AFFiNE"],
  title: "AFFiNE",
});

const readeck = template({
  description: "Readeck saves web pages for later reading, an asset tool.",
  name: "readeck",
  title: "Readeck",
});

const catalog = [affine, glpi, readeck];

test("scores an exact template name above a description-only hit", () => {
  assert.ok(
    scoreTemplateForQuery(glpi, "glpi") > scoreTemplateForQuery(readeck, "glpi")
  );
});

test("ranks the exact template first for a bare application name", () => {
  const matches = rankDeployCatalog(catalog, "glpi", 5);
  assert.equal(matches[0]?.templateName, "glpi");
});

test("matches a template through its curated source repository URL", () => {
  const matches = rankDeployCatalog(
    catalog,
    "https://github.com/glpi-project/glpi",
    5
  );
  assert.equal(matches[0]?.templateName, "glpi");
});

test("surfaces required args and blocks default-only deployment", () => {
  const [match] = rankDeployCatalog(catalog, "glpi", 5);
  assert.equal(match?.canDeployWithDefaults, false);
  assert.deepEqual(
    match?.requiredArgs.map((arg) => arg.key),
    ["admin_password"]
  );
  assert.equal(match?.gitRepo, "https://github.com/glpi-project/glpi");
});

test("reports a template that needs no input as default-deployable", () => {
  const [match] = rankDeployCatalog(catalog, "affine", 5);
  assert.equal(match?.canDeployWithDefaults, true);
  assert.deepEqual(match?.requiredArgs, []);
});

test("returns no matches when nothing in the catalog is relevant", () => {
  assert.deepEqual(rankDeployCatalog(catalog, "nonexistentapp", 5), []);
});

test("honours the requested limit", () => {
  assert.equal(rankDeployCatalog(catalog, "tool", 1).length, 1);
});

test("returns matches and catalog size through the tool", async () => {
  const tool = createSearchDeployCatalogTool({
    listTemplateCatalog: () => Promise.resolve(catalog),
  });
  const result = await tool.execute?.(
    { intention: "find the glpi template", limit: 5, query: "glpi" },
    { context: {}, messages: [], toolCallId: "call-1" }
  );
  assert.deepEqual(result, {
    matches: rankDeployCatalog(catalog, "glpi", 5),
    ok: true,
    totalCatalogSize: catalog.length,
  });
});

test("degrades to a tool-level error when the provider is unreachable", async () => {
  const tool = createSearchDeployCatalogTool({
    listTemplateCatalog: () =>
      Promise.reject(new Error("TEMPLATE_PROVIDER_URL is not configured.")),
  });
  const result = await tool.execute?.(
    { intention: "find the glpi template", limit: 5, query: "glpi" },
    { context: {}, messages: [], toolCallId: "call-2" }
  );
  assert.deepEqual(result, {
    error: DEPLOY_CATALOG_UNAVAILABLE_ERROR,
    ok: false,
  });
});
