import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";

const FETCH_TIMEOUT_MS = 30_000;
const OPERATION_JSON_MAX_CHARS = 200_000;
const METHODS_LOWER = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

const TRAILING_SLASHES_AT_END_OF_PATHNAME = /\/+$/;
const TRAILING_SLASHES_AT_END_OF_HREF = /\/+$/;
const FRAGMENT_LEADING_HASH_TRIM = /^#\s*/;
const PATHNAME_ENDS_JSON = /\.json$/i;
const PATHNAME_ENDS_YAML_OR_YML = /\.ya?ml$/i;
const INLINE_WHITESPACE_RUNS = /\s+/g;

interface LoadedOpenApi {
  knownOrdered: string[];
  paths: Record<string, unknown>;
  spec: Record<string, unknown>;
  specUrl: string;
  tagMeta: Map<string, { description?: string }>;
}

type MethodLower = (typeof METHODS_LOWER)[number];

function isHttpMethodLower(k: string): k is MethodLower {
  return (METHODS_LOWER as readonly string[]).includes(k);
}

/**
 * Seal serves Scalar at `/docs` and references `/openapi.json` on the same origin.
 */
export function resolveOpenApiSpecJsonUrl(
  openapiDocsBaseSansHash: string
): string | null {
  const raw = openapiDocsBaseSansHash.trim();
  if (raw === "") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  let path = parsed.pathname.replace(TRAILING_SLASHES_AT_END_OF_PATHNAME, "");
  if (path === "") {
    path = "/";
  }

  // Direct spec URLs
  if (PATHNAME_ENDS_JSON.test(path) || PATHNAME_ENDS_YAML_OR_YML.test(path)) {
    return parsed.toString();
  }

  // Typical Scalar/Swagger "docs UI" sibling to `/openapi.json` on origin
  if (path === "/docs" || path.endsWith("/docs")) {
    return new URL(`${parsed.origin}/openapi.json`).toString();
  }

  // API root → `${origin}/openapi.json`
  const baseForJoin =
    parsed.pathname === "/" || parsed.pathname === ""
      ? `${parsed.origin}/`
      : `${parsed.href.replace(TRAILING_SLASHES_AT_END_OF_HREF, "")}/`;

  try {
    return new URL("openapi.json", baseForJoin).toString();
  } catch {
    return null;
  }
}

function splitDocsInput(inputUrl: string): {
  baseWithoutHash: string;
  fragment?: string;
} {
  const hashIdx = inputUrl.indexOf("#");
  if (hashIdx === -1) {
    return { baseWithoutHash: inputUrl };
  }
  return {
    baseWithoutHash: inputUrl.slice(0, hashIdx),
    fragment: decodeURIComponent(inputUrl.slice(hashIdx + 1)),
  };
}

/** Scalar/Swagger style `#tag/name` fragments */
export function parseTagFragment(fragment: string | undefined): string | null {
  if (fragment === undefined || fragment === "") {
    return null;
  }
  const f = fragment.replace(FRAGMENT_LEADING_HASH_TRIM, "").trimStart();
  if (f.startsWith("tag/")) {
    const name = decodeURIComponent(f.slice("tag/".length));
    return name.length > 0 ? name : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson(
  specUrl: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(specUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept:
          "application/json, application/yaml;q=0.8, text/*;q=0.1,*/*;q=0.05",
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `OpenAPI spec GET failed: HTTP ${String(response.status)}`,
      };
    }
    const text = await response.text();
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return {
        ok: false,
        error:
          "OpenAPI payload is not JSON. Point `openapiDocsBase` at `/openapi.json` (YAML is not parsed here).",
      };
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown fetch error fetching OpenAPI";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

function mergeTagDescriptions(
  spec: Record<string, unknown>
): Map<string, { description?: string }> {
  const out = new Map<string, { description?: string }>();
  const declared = spec.tags;
  if (Array.isArray(declared)) {
    for (const t of declared) {
      if (!isRecord(t) || typeof t.name !== "string") {
        continue;
      }
      out.set(t.name, {
        ...(typeof t.description === "string"
          ? { description: t.description }
          : {}),
      });
    }
  }
  return out;
}

function normalizeTag(spec: Record<string, unknown>): string[] {
  const raw = spec.tags;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x): x is string => typeof x === "string");
}

function endpointCountPerTag(
  paths: Record<string, unknown>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const key of Object.keys(pathItem)) {
      if (!isHttpMethodLower(key)) {
        continue;
      }
      const op = pathItem[key];
      if (!isRecord(op)) {
        continue;
      }
      for (const tag of normalizeTag(op)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function resolveTagName(
  fragmentTag: string,
  knownTags: string[]
): string | null {
  const exact = knownTags.find((t) => t === fragmentTag);
  if (exact) {
    return exact;
  }
  const lowercase = fragmentTag.trim().toLowerCase();
  const ci = knownTags.find((t) => t.trim().toLowerCase() === lowercase);
  return ci ?? null;
}

type OperationRecord = Record<string, unknown>;

function stringifyOperation(op: OperationRecord): string {
  const s = JSON.stringify(op, null, 2);
  if (s.length > OPERATION_JSON_MAX_CHARS) {
    return `${s.slice(0, OPERATION_JSON_MAX_CHARS)}\n…[truncated]`;
  }
  return s;
}

const sliceOpenApiDocsInputSchema = z.object({
  intention: chatToolIntentionField,
  openapiDocsBase: z
    .string()
    .min(1)
    .describe(
      "OpenAPI docs URL: Scalar/Swagger page (…/docs), API origin, or …/openapi.json. Append `#tag/GroupName` after the docs URL when drilling into a tag (e.g. `http://localhost:9000/docs#tag/db` matches OpenAPI tag `DB` via case‑insensitive lookup)."
    ),
  endpointOpenApiPath: z
    .string()
    .optional()
    .describe(
      "Exact OpenAPI `paths` key (path template). When provided, returns the full operation definition for calling the API (`parameters`, `requestBody`, `responses`, etc.). Combine with `httpMethod` when several verbs share one path template."
    ),
  httpMethod: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"])
    .optional()
    .describe(
      "Required when multiple HTTP verbs exist on `endpointOpenApiPath`; selects one operation payload."
    ),
});

export type SliceOpenApiDocsInput = z.infer<typeof sliceOpenApiDocsInputSchema>;

function summarizeText(s: unknown, max = 520): string | undefined {
  if (typeof s !== "string" || s.trim() === "") {
    return undefined;
  }
  const t = s.trim().replace(INLINE_WHITESPACE_RUNS, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function suggestPathKeys(
  paths: Record<string, unknown>,
  query: string
): string[] {
  const q = query.toLowerCase();
  return Object.keys(paths)
    .filter((p) => p.includes(query) || p.toLowerCase().includes(q))
    .slice(0, 16);
}

function resolveCanonicalPathsKey(
  paths: Record<string, unknown>,
  rawPathKey: string
): string {
  if (isRecord(paths[rawPathKey])) {
    return rawPathKey;
  }
  const trimmed =
    rawPathKey.replace(TRAILING_SLASHES_AT_END_OF_PATHNAME, "") || "/";
  const withSlash = trimmed === rawPathKey ? `${rawPathKey}/` : `${trimmed}/`;
  if (isRecord(paths[trimmed])) {
    return trimmed;
  }
  if (isRecord(paths[withSlash])) {
    return withSlash;
  }
  return rawPathKey;
}

async function loadOpenApiPayload(baseSansHash: string): Promise<
  | {
      ok: true;
      payload: LoadedOpenApi;
    }
  | {
      ok: false;
      error: string;
      specUrl?: string;
    }
> {
  const specUrl = resolveOpenApiSpecJsonUrl(baseSansHash);
  if (specUrl === null) {
    return {
      ok: false,
      error:
        "`openapiDocsBase` was not a valid URL (after stripping `#…`). Provide e.g. `http://localhost:9000/docs` or API root.",
    };
  }

  const fetched = await fetchJson(specUrl);
  if (!fetched.ok) {
    return { ok: false, specUrl, error: fetched.error };
  }
  const spec = fetched.data;
  if (!isRecord(spec)) {
    return {
      ok: false,
      specUrl,
      error: "OpenAPI root is not a JSON object.",
    };
  }

  const pathsRaw = spec.paths;
  const paths = pathsRaw !== undefined && isRecord(pathsRaw) ? pathsRaw : {};
  const tagMeta = mergeTagDescriptions(spec);
  const inferredTags = [...endpointCountPerTag(paths).keys()].sort();
  const knownOrdered = [...tagMeta.keys(), ...inferredTags]
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    payload: { specUrl, spec, paths, knownOrdered, tagMeta },
  };
}

function pickOperationsFromPathItem(
  pathItem: OperationRecord,
  explicitMethodLower: string | undefined
): { methodKey: MethodLower; op: OperationRecord }[] {
  const picked: { methodKey: MethodLower; op: OperationRecord }[] = [];
  for (const k of Object.keys(pathItem)) {
    if (!isHttpMethodLower(k)) {
      continue;
    }
    const op = pathItem[k];
    if (!isRecord(op)) {
      continue;
    }
    if (explicitMethodLower !== undefined && k !== explicitMethodLower) {
      continue;
    }
    picked.push({ methodKey: k, op });
  }
  return picked;
}

function sliceOpenApiEndpoint(
  loaded: LoadedOpenApi,
  endpointPath: string,
  httpMethod: SliceOpenApiDocsInput["httpMethod"]
) {
  const { specUrl, paths } = loaded;
  const rawPathKey = endpointPath.trim();
  const pathKey = resolveCanonicalPathsKey(paths, rawPathKey);

  const pathItem = paths[pathKey];
  if (!isRecord(pathItem)) {
    const sampleKeys = suggestPathKeys(paths, rawPathKey);
    return {
      ok: false as const,
      specUrl,
      error: `No OpenAPI paths entry matching \`${endpointPath}\`.`,
      ...(sampleKeys.length > 0 ? { pathTemplatesLikeQuery: sampleKeys } : {}),
    };
  }

  const explicitMethod = httpMethod?.toLowerCase();
  const picked = pickOperationsFromPathItem(pathItem, explicitMethod);

  if (picked.length === 0) {
    const availableMethods = Object.keys(pathItem).filter(isHttpMethodLower);
    return {
      ok: false as const,
      specUrl,
      pathTemplate: pathKey,
      error:
        explicitMethod === undefined
          ? `Path \`${pathKey}\` has no recognizable HTTP operations.`
          : `No \`${explicitMethod.toUpperCase()}\` on \`${pathKey}\`. Available: ${availableMethods.join(", ") || "(none)"}.`,
    };
  }

  if (picked.length > 1 && explicitMethod === undefined) {
    return {
      ok: true as const,
      level: "operation_pick_http_method",
      specUrl,
      docsHint:
        "`endpointOpenApiPath` matches multiple methods; retry with `httpMethod` set to disambiguate.",
      pathTemplate: pathKey,
      methods: picked.map(({ methodKey, op }) => ({
        httpMethod: methodKey.toUpperCase(),
        summary: summarizeText(op.summary),
        description: summarizeText(op.description),
        operationId:
          typeof op.operationId === "string" ? op.operationId : undefined,
      })),
    };
  }

  const chosen = picked[0];
  if (!chosen) {
    return {
      ok: false as const,
      specUrl,
      pathTemplate: pathKey,
      error: "Internal error: matched operations vanished during selection.",
    };
  }

  const { methodKey, op } = chosen;
  const opTags = normalizeTag(op);
  const primaryTagName = opTags[0];
  const docsRouteForTag =
    primaryTagName === undefined
      ? undefined
      : `#tag/${encodeURIComponent(primaryTagName)}`;

  return {
    ok: true as const,
    level: "operation",
    specUrl,
    docsRouteForTag,
    pathTemplate: pathKey,
    httpMethod: methodKey.toUpperCase(),
    operationId:
      typeof op.operationId === "string" ? op.operationId : undefined,
    operationJson: stringifyOperation(op),
  };
}

interface TagEndpointBrief {
  description?: string;
  httpMethod: string;
  operationId?: string;
  pathTemplate: string;
  summary?: string;
}

function briefTaggedOperation(
  pathTemplate: string,
  methodLower: MethodLower,
  operation: OperationRecord,
  resolvedTag: string
): TagEndpointBrief | null {
  if (!normalizeTag(operation).includes(resolvedTag)) {
    return null;
  }
  return {
    httpMethod: methodLower.toUpperCase(),
    pathTemplate,
    summary:
      typeof operation.summary === "string"
        ? operation.summary.trim() || undefined
        : undefined,
    description: summarizeText(operation.description),
    operationId:
      typeof operation.operationId === "string"
        ? operation.operationId
        : undefined,
  };
}

function collectEndpointsForTag(
  paths: Record<string, unknown>,
  resolvedTag: string
): TagEndpointBrief[] {
  const endpoints: TagEndpointBrief[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const methodLower of Object.keys(pathItem)) {
      if (!isHttpMethodLower(methodLower)) {
        continue;
      }
      const operation = pathItem[methodLower];
      if (!isRecord(operation)) {
        continue;
      }
      const brief = briefTaggedOperation(
        pathTemplate,
        methodLower,
        operation,
        resolvedTag
      );
      if (brief !== null) {
        endpoints.push(brief);
      }
    }
  }

  return endpoints;
}

function sliceOpenApiTagGroup(loaded: LoadedOpenApi, fragmentTag: string) {
  const { specUrl, paths, knownOrdered } = loaded;
  const resolved = resolveTagName(fragmentTag, knownOrdered);
  if (resolved === null) {
    return {
      ok: false as const,
      specUrl,
      error: `Unknown tag/group \`${fragmentTag}\` (from fragment). Known tags: ${knownOrdered.join(", ") || "(none declared)"}.`,
    };
  }

  const endpoints = collectEndpointsForTag(paths, resolved);

  endpoints.sort((a, b) => {
    const pc = a.pathTemplate.localeCompare(b.pathTemplate);
    if (pc === 0) {
      return a.httpMethod.localeCompare(b.httpMethod);
    }
    return pc;
  });

  return {
    ok: true as const,
    level: "tag",
    specUrl,
    tagName: resolved,
    docRoute: `#tag/${encodeURIComponent(resolved)}`,
    endpoints,
  };
}

function sliceOpenApiOverview(loaded: LoadedOpenApi) {
  const { specUrl, spec, paths, knownOrdered, tagMeta } = loaded;
  const counts = endpointCountPerTag(paths);

  const tags = knownOrdered.map((name) => ({
    tagName: name,
    docRoute: `#tag/${encodeURIComponent(name)}`,
    ...(tagMeta.get(name)?.description
      ? { description: summarizeText(tagMeta.get(name)?.description, 960) }
      : {}),
    endpointCount: counts.get(name) ?? 0,
  }));

  const openapiVers =
    typeof spec.openapi === "string" ? spec.openapi : undefined;
  const apiTitle =
    isRecord(spec.info) && typeof spec.info.title === "string"
      ? spec.info.title
      : undefined;

  return {
    ok: true as const,
    level: "overview",
    specUrl,
    openapiVersion: openapiVers,
    apiTitle,
    tags,
    note: "Append `#tag/&lt;TagName&gt;` to `openapiDocsBase`, or pass `endpointOpenApiPath` (+ `httpMethod` if needed) for full operation payloads.",
  };
}

export const sliceOpenApiDocsTool = tool({
  description: [
    "Fetch an OpenAPI 3 JSON spec (resolved from `/docs`-style URLs or `/openapi.json`) and return progressively smaller slices so the model avoids loading the whole Swagger/Scalar bundle.",
    "Levels: base URL only → tag groups plus each `#tag/name` anchor path; `#tag/name` appended to the docs URL → list operations in that tag (methods, templates, summaries, brief descriptions); plus `endpointOpenApiPath` (and normally `httpMethod`) → JSON for that single HTTP operation (`parameters`, `requestBody`, `responses`, schemas) suitable for drafting correct HTTP calls (logs, metrics, etc.).",
    "Include `intention`: why you need this slice (e.g. find logs endpoint after mutation).",
  ].join(" "),
  inputSchema: sliceOpenApiDocsInputSchema,
  execute: async (input) => {
    logChatToolIntention("sliceOpenApiDocs", input.intention);
    const { baseWithoutHash, fragment } = splitDocsInput(input.openapiDocsBase);
    const fragmentTag = parseTagFragment(fragment);

    const loaded = await loadOpenApiPayload(baseWithoutHash);
    if (!loaded.ok) {
      return {
        ok: false as const,
        specUrl: loaded.specUrl,
        error: loaded.error,
      };
    }

    const payload = loaded.payload;
    const endpointTrimmed = input.endpointOpenApiPath?.trim();
    if (endpointTrimmed !== undefined && endpointTrimmed !== "") {
      return sliceOpenApiEndpoint(payload, endpointTrimmed, input.httpMethod);
    }
    if (fragmentTag) {
      return sliceOpenApiTagGroup(payload, fragmentTag);
    }
    return sliceOpenApiOverview(payload);
  },
});
