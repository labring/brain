import "server-only";

import type { UIMessage } from "ai";

import {
  DEPLOY_INTENT_CONTEXT_PART_TYPE,
  type DeployIntentContext,
  deployIntentEnvelopeSchema,
  MAX_DEPLOY_INTENT_PARTS_PER_MESSAGE,
} from "@/features/chat/persistence/deploy-intent-context";
import { parseGithubRepoUrl } from "@/features/deploy/deploy-intent-link";
import { isSensitiveDeploymentInput } from "@/features/deploy/task/sensitive-inputs";
import {
  listTemplateCatalog,
  type TemplateCatalogInput,
  type TemplateCatalogItem,
} from "@/features/deploy/template-provider-core";

/**
 * Fail-closed inbound validation for `data-deployIntent` parts on POST
 * /api/chat.
 *
 * Every user message crossing the chat route is scrubbed here regardless of
 * who produced the part (the client, or an attacker forging a request): at
 * most one structurally valid intent is accepted, and each kind is validated
 * against its authority before the model sees it:
 *
 * - `template`: the `templateName` must exist verbatim in `listTemplateCatalog`
 *   (a fresh provider read each request). `args` may only contain
 *   catalog-declared inputs, values must match the declared type, and
 *   sensitive inputs are stripped with `isSensitiveDeploymentInput` — secrets
 *   never travel in a URL intent.
 * - `github`: aligned with `chatDeploymentTaskSourceSchema` — legal HTTPS
 *   github.com URL, consistent owner/repo, bounded branch.
 * - `topic`: bounded free text only (length/whitespace/newline checks); it is
 *   handed to the Agent as low-trust data for catalog disambiguation.
 *
 * Any failure — malformed envelope, catalog unavailable, unknown template,
 * undeclared/type-invalid arg, duplicate parts — drops the *entire* intent
 * part (or all of them) without blocking ordinary conversation. The validated
 * payload replaces the original part data so the persisted audit trail matches
 * exactly what the model consumes (ADR-0072).
 */
export interface DeployIntentValidationDependencies {
  listTemplateCatalog?: typeof listTemplateCatalog;
}

interface DeployIntentPart {
  data?: unknown;
  type: string;
}

function isDeployIntentPart(part: unknown): part is DeployIntentPart {
  return (
    part != null &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === DEPLOY_INTENT_CONTEXT_PART_TYPE
  );
}

function withoutDeployIntentParts(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.filter((part) => !isDeployIntentPart(part)),
  };
}

/**
 * Scrub the intent parts of one incoming user message. Returns a message whose
 * parts carry at most one validated intent.
 */
export async function sanitizeDeployIntentParts(
  message: UIMessage,
  dependencies: DeployIntentValidationDependencies = {}
): Promise<UIMessage> {
  const intentParts = message.parts.filter(isDeployIntentPart);
  if (intentParts.length === 0) {
    return message;
  }
  if (intentParts.length > MAX_DEPLOY_INTENT_PARTS_PER_MESSAGE) {
    return withoutDeployIntentParts(message);
  }
  const validated = await validateDeployIntentPayload(
    (intentParts[0] as { data?: unknown } | undefined)?.data,
    dependencies
  );
  if (validated == null) {
    return withoutDeployIntentParts(message);
  }
  return {
    ...message,
    parts: message.parts.map((part) =>
      isDeployIntentPart(part) ? { ...part, data: validated } : part
    ),
  };
}

/**
 * Full fail-closed validation of one intent envelope. Returns the sanitized
 * context (template args filtered, topic query normalized) or `null`.
 */
export function validateDeployIntentPayload(
  value: unknown,
  dependencies: DeployIntentValidationDependencies = {}
): Promise<DeployIntentContext | null> {
  const parsed = deployIntentEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return Promise.resolve(null);
  }
  switch (parsed.data.kind) {
    case "template":
      return validateTemplateIntent(parsed.data, dependencies);
    case "github":
      return Promise.resolve(validateGithubIntent(parsed.data));
    case "topic":
      // Boundary checks only; the Agent treats the query as low-trust data.
      return Promise.resolve(parsed.data);
    default:
      return Promise.resolve(parsed.data satisfies never);
  }
}

async function validateTemplateIntent(
  envelope: Extract<DeployIntentContext, { kind: "template" }>,
  dependencies: DeployIntentValidationDependencies
): Promise<DeployIntentContext | null> {
  const payload = envelope.payload;
  let catalog: TemplateCatalogItem[];
  try {
    catalog = await (dependencies.listTemplateCatalog ?? listTemplateCatalog)();
  } catch {
    // Catalog unavailable: there is no way to prove the templateName is
    // canonical, so fail closed and drop the intent (ADR-0072).
    return null;
  }
  const item = catalog.find(
    (template) => template.name === payload.templateName
  );
  if (item == null) {
    return null;
  }
  const declared = new Map<string, TemplateCatalogInput>(
    item.args.map((input) => [input.key, input])
  );
  const sanitizedArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.args ?? {})) {
    const input = declared.get(key);
    if (input == null) {
      // Only catalog-declared inputs are allowed; anything else is a
      // fail-closed rejection of the whole intent.
      return null;
    }
    if (isSensitiveDeploymentInput({ key, type: input.type })) {
      // Secrets never travel in a URL intent: strip, do not persist.
      continue;
    }
    if (!templateArgValueMatchesType(input, value)) {
      return null;
    }
    sanitizedArgs[key] = value;
  }
  return {
    ...envelope,
    payload: {
      templateName: item.name,
      ...(Object.keys(sanitizedArgs).length > 0 ? { args: sanitizedArgs } : {}),
    },
  };
}

function templateArgValueMatchesType(
  input: TemplateCatalogInput,
  value: string
): boolean {
  const type = input.type.trim().toLowerCase();
  const trimmed = value.trim();
  if (type === "number") {
    return trimmed !== "" && Number.isFinite(Number(trimmed));
  }
  if (type === "boolean") {
    return trimmed === "true" || trimmed === "false";
  }
  return true;
}

function validateGithubIntent(
  envelope: Extract<DeployIntentContext, { kind: "github" }>
): DeployIntentContext | null {
  const payload = envelope.payload;
  const repo = parseGithubRepoUrl(payload.repo.url);
  if (repo == null) {
    return null;
  }
  const urlFullName = repo.fullName.toLowerCase();
  const urlName = repo.name.toLowerCase();
  if (payload.repo.fullName.trim().toLowerCase() !== urlFullName) {
    return null;
  }
  if (payload.repo.name.trim().toLowerCase() !== urlName) {
    return null;
  }
  const branch = payload.branch?.trim();
  if (payload.branch != null && branch === "") {
    return null;
  }
  return {
    ...envelope,
    payload: {
      repo: {
        fullName: repo.fullName,
        name: repo.name,
        url: payload.repo.url.trim(),
        ...(payload.repo.id == null ? {} : { id: payload.repo.id.trim() }),
      },
      ...(branch == null ? {} : { branch }),
    },
  };
}
