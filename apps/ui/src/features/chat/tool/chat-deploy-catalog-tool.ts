import { tool } from "ai";
import { z } from "zod";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import {
  normalizeGithubRepoReference,
  templateCanDeployWithDefaults,
} from "@/features/deploy/github/github-template-match";
import {
  listTemplateCatalog,
  type TemplateCatalogItem,
} from "@/features/deploy/template-provider-core";

/**
 * Returned when the template provider is unset or unreachable. The model must
 * degrade to a `github`/`prompt` source instead of failing the whole turn, so
 * this is a tool-level result rather than a thrown error.
 */
export const DEPLOY_CATALOG_UNAVAILABLE_ERROR =
  "Template catalog is unavailable; fall back to a prompt source.";

const SCORE_EXACT_NAME = 100;
const SCORE_NAME_TOKEN = 60;
const SCORE_SOURCE_REPO = 50;
const SCORE_TEXT_TOKEN = 10;

const TOKEN_SPLIT_RE = /[^a-z0-9.+#-]+/;

export const searchDeployCatalogInputSchema = z.object({
  intention: chatToolIntentionField,
  limit: z.number().int().min(1).max(10).default(5),
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "Application the user asked to deploy, e.g. `glpi`, `GLPI helpdesk`, or a GitHub repository URL."
    ),
});

export interface DeployCatalogRequiredArg {
  default?: string;
  description: string;
  key: string;
  options?: string[];
  type: string;
}

export interface DeployCatalogMatch {
  canDeployWithDefaults: boolean;
  categories: string[];
  description: string;
  gitRepo: string | null;
  requiredArgs: DeployCatalogRequiredArg[];
  templateName: string;
  title: string;
}

function queryTokens(normalizedQuery: string): string[] {
  return normalizedQuery
    .split(TOKEN_SPLIT_RE)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

/**
 * Rank one template against a free-text query. Exact name/title beats a token
 * hit on the name, which beats a curated `sourceRepos` hit, which beats a
 * description or category hit.
 */
export function scoreTemplateForQuery(
  template: TemplateCatalogItem,
  query: string
): number {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = queryTokens(normalizedQuery);
  if (tokens.length === 0) {
    return 0;
  }

  const name = template.name.toLowerCase();
  const title = template.title.toLowerCase();
  let score = 0;

  if (name === normalizedQuery || title === normalizedQuery) {
    score += SCORE_EXACT_NAME;
  }

  const repoReference = normalizeGithubRepoReference(normalizedQuery);
  if (
    repoReference != null &&
    template.sourceRepos.some(
      (sourceRepo) => normalizeGithubRepoReference(sourceRepo) === repoReference
    )
  ) {
    score += SCORE_SOURCE_REPO;
  }

  const haystack =
    `${template.description} ${template.category.join(" ")}`.toLowerCase();
  for (const token of tokens) {
    if (name.includes(token) || title.includes(token)) {
      score += SCORE_NAME_TOKEN;
    } else if (haystack.includes(token)) {
      score += SCORE_TEXT_TOKEN;
    }
  }

  return score;
}

function toDeployCatalogMatch(
  template: TemplateCatalogItem
): DeployCatalogMatch {
  return {
    canDeployWithDefaults: templateCanDeployWithDefaults(template),
    categories: template.category,
    description: template.description,
    gitRepo: template.sourceRepos[0] ?? null,
    requiredArgs: template.args
      .filter((arg) => arg.required)
      .map((arg) => ({
        default: arg.default,
        description: arg.description,
        key: arg.key,
        options: arg.options,
        type: arg.type,
      })),
    templateName: template.name,
    title: template.title,
  };
}

/** Score every template, drop non-matches, and return the best `limit` items. */
export function rankDeployCatalog(
  catalog: readonly TemplateCatalogItem[],
  query: string,
  limit: number
): DeployCatalogMatch[] {
  return catalog
    .map((template) => ({
      score: scoreTemplateForQuery(template, query),
      template,
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.template.name.localeCompare(right.template.name)
    )
    .slice(0, limit)
    .map((entry) => toDeployCatalogMatch(entry.template));
}

export function buildSearchDeployCatalogDescription(): string {
  return [
    "Search the Sealos template catalog for a curated deployment template.",
    "Call this before choosing a Deployment Source whenever the user asks to deploy, install, or run a named application.",
    "Returns ranked candidates with the exact `templateName` to pass to `createDeployTask` as a `template` source, plus the arguments that template requires.",
    "An empty match list means no curated template exists; fall back to a `github` source when the user named a repository, otherwise a `prompt` source.",
  ].join(" ");
}

/**
 * `dependencies` is a test seam; production callers use the cached provider
 * fetch in `listTemplateCatalog`.
 */
export function createSearchDeployCatalogTool(
  dependencies: { listTemplateCatalog?: typeof listTemplateCatalog } = {}
) {
  const readCatalog = dependencies.listTemplateCatalog ?? listTemplateCatalog;
  return tool({
    description: buildSearchDeployCatalogDescription(),
    inputSchema: searchDeployCatalogInputSchema,
    execute: async (input) => {
      logChatToolIntention("searchDeployCatalog", input.intention);
      let catalog: TemplateCatalogItem[];
      try {
        catalog = await readCatalog();
      } catch {
        return { ok: false, error: DEPLOY_CATALOG_UNAVAILABLE_ERROR };
      }
      return {
        ok: true,
        matches: rankDeployCatalog(catalog, input.query, input.limit),
        totalCatalogSize: catalog.length,
      };
    },
  });
}
