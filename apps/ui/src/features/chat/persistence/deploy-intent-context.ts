import { z } from "zod";

/**
 * Deployment Intent — message-level context for the Assistant.
 *
 * A deployment intent is a small, structured envelope that external entry
 * points (the Template site, GitHub one-click deploy, a blog, or a solution
 * page) attach to the Brain entry URL as `?intent=<encoded-json>`. On the
 * client it is converted once into a `data-deployIntent` UI message part on a
 * synthetic first user message; on the server it is re-validated fail-closed
 * before the model ever sees it (see the runtime validation module and ADR
 * 0065). The part is *data, not instructions*: the model receives it only
 * through the message-level bridge, never through the system prompt.
 *
 * Trust model: the payload originates from an external URL, so every field is
 * untrusted until the server validates it. Secrets (tokens, passwords,
 * kubeconfigs) are never accepted — template args are filtered against the
 * catalog with `isSensitiveDeploymentInput`, and the protocol bans them.
 */
export const DEPLOY_INTENT_CONTEXT_PART_TYPE = "data-deployIntent" as const;
export const DEPLOY_INTENT_VERSION = 1 as const;
export const DEPLOY_INTENT_QUERY_KEY = "intent" as const;

export const DEPLOY_INTENT_SOURCE_MAX_LENGTH = 1024;
export const DEPLOY_INTENT_TEMPLATE_NAME_MAX_LENGTH = 256;
export const DEPLOY_INTENT_REPO_FULLNAME_MAX_LENGTH = 512;
export const DEPLOY_INTENT_REPO_NAME_MAX_LENGTH = 256;
export const DEPLOY_INTENT_REPO_URL_MAX_LENGTH = 2048;
export const DEPLOY_INTENT_REPO_ID_MAX_LENGTH = 128;
export const DEPLOY_INTENT_BRANCH_MAX_LENGTH = 256;
export const DEPLOY_INTENT_QUERY_MAX_LENGTH = 2000;
export const DEPLOY_INTENT_REF_MAX_LENGTH = 256;
export const DEPLOY_INTENT_ARGS_MAX_ENTRIES = 64;
export const DEPLOY_INTENT_ARG_KEY_MAX_LENGTH = 128;
export const DEPLOY_INTENT_ARG_VALUE_MAX_LENGTH = 4096;

const boundedSource = z
  .string()
  .trim()
  .max(DEPLOY_INTENT_SOURCE_MAX_LENGTH)
  .optional();

const templateDeployIntentPayloadSchema = z.object({
  templateName: z
    .string()
    .trim()
    .min(1)
    .max(DEPLOY_INTENT_TEMPLATE_NAME_MAX_LENGTH),
  args: z
    .record(
      z.string().trim().min(1).max(DEPLOY_INTENT_ARG_KEY_MAX_LENGTH),
      z.string().max(DEPLOY_INTENT_ARG_VALUE_MAX_LENGTH)
    )
    .refine(
      (args) => Object.keys(args).length <= DEPLOY_INTENT_ARGS_MAX_ENTRIES,
      `args must have at most ${DEPLOY_INTENT_ARGS_MAX_ENTRIES} entries`
    )
    .optional(),
});

const githubDeployIntentPayloadSchema = z.object({
  repo: z.object({
    fullName: z
      .string()
      .trim()
      .min(1)
      .max(DEPLOY_INTENT_REPO_FULLNAME_MAX_LENGTH),
    id: z.string().trim().max(DEPLOY_INTENT_REPO_ID_MAX_LENGTH).optional(),
    name: z.string().trim().min(1).max(DEPLOY_INTENT_REPO_NAME_MAX_LENGTH),
    url: z.string().trim().max(DEPLOY_INTENT_REPO_URL_MAX_LENGTH).url(),
  }),
  branch: z
    .string()
    .trim()
    .min(1)
    .max(DEPLOY_INTENT_BRANCH_MAX_LENGTH)
    .optional(),
});

/**
 * Topic intent is deliberately low-trust: it is bounded free text (length,
 * whitespace, and newline boundary checks only) and is handed to the Agent as
 * data, not as a deployment instruction. The Agent disambiguates it with
 * `searchDeployCatalog` and asks the user before creating anything.
 */
const topicDeployIntentPayloadSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(DEPLOY_INTENT_QUERY_MAX_LENGTH)
    // Newlines are structural, not content: collapse them so a crafted query
    // cannot smuggle multi-line "instructions" past the data framing.
    .transform((value) => value.replace(/[\r\n]+/g, " ").trim())
    .pipe(z.string().min(1).max(DEPLOY_INTENT_QUERY_MAX_LENGTH)),
  ref: z.string().trim().max(DEPLOY_INTENT_REF_MAX_LENGTH).optional(),
});

export const deployIntentEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("template"),
    payload: templateDeployIntentPayloadSchema,
    source: boundedSource,
    version: z.literal(DEPLOY_INTENT_VERSION),
  }),
  z.object({
    kind: z.literal("github"),
    payload: githubDeployIntentPayloadSchema,
    source: boundedSource,
    version: z.literal(DEPLOY_INTENT_VERSION),
  }),
  z.object({
    kind: z.literal("topic"),
    payload: topicDeployIntentPayloadSchema,
    source: boundedSource,
    version: z.literal(DEPLOY_INTENT_VERSION),
  }),
]);

export type TemplateDeployIntentPayload = z.infer<
  typeof templateDeployIntentPayloadSchema
>;
export type GithubDeployIntentPayload = z.infer<
  typeof githubDeployIntentPayloadSchema
>;
export type TopicDeployIntentPayload = z.infer<
  typeof topicDeployIntentPayloadSchema
>;
export type DeployIntentContext = z.infer<typeof deployIntentEnvelopeSchema>;

/** Exactly one intent per message; a run of parts is rejected as ambiguous. */
export const MAX_DEPLOY_INTENT_PARTS_PER_MESSAGE = 1;

/**
 * Read + validate the pinned deployment intent from a message.
 *
 * Returns `null` when the part is absent, malformed, or repeated. The bridge
 * and the server validator share this narrowing so a malformed part is never
 * surfaced to the model.
 */
export function readDeployIntentContext(message: {
  parts: readonly unknown[];
}): DeployIntentContext | null {
  let data: unknown;
  let count = 0;
  for (const part of message.parts) {
    if (
      part == null ||
      typeof part !== "object" ||
      (part as { type?: unknown }).type !== DEPLOY_INTENT_CONTEXT_PART_TYPE
    ) {
      continue;
    }
    count += 1;
    data = (part as { data?: unknown }).data;
  }
  if (count !== MAX_DEPLOY_INTENT_PARTS_PER_MESSAGE) {
    return null;
  }
  const parsed = deployIntentEnvelopeSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Neutral transcript text for the synthetic user message that carries the
 * intent. The model's actionable context comes from the bridge block, not from
 * this line, so the text stays short and never echoes raw topic query text
 * beyond what the user themselves would have typed.
 */
export function deployIntentPromptText(intent: DeployIntentContext): string {
  switch (intent.kind) {
    case "template":
      return `Deploy the "${intent.payload.templateName}" template from a shared link.`;
    case "github": {
      const branch = intent.payload.branch?.trim();
      return branch
        ? `Deploy the GitHub repository ${intent.payload.repo.fullName} (branch ${branch}) from a shared link.`
        : `Deploy the GitHub repository ${intent.payload.repo.fullName} from a shared link.`;
    }
    case "topic":
      return `Deploy: ${intent.payload.query}`;
    default:
      return intent satisfies never;
  }
}
