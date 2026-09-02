import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";
import {
  NAVIGATE_APP_TOOL_NAME,
  navigateAppOutputSchema,
} from "@/features/chat/tool/chat-navigate-app-tool";
import {
  OPEN_PROJECT_SURFACE_TOOL_NAME,
  openProjectSurfaceOutputSchema,
} from "@/features/chat/tool/chat-open-project-surface-tool";
import {
  REFRESH_FRONTEND_SWR_TOOL_NAME,
  refreshFrontendSwrCachesOutputSchema,
} from "@/features/chat/tool/chat-refresh-frontend-swr-tool";
import type {
  PersonalResourceOwner,
  VerifiedPersonalResourceActor,
} from "@/lib/verified-personal-actor";

/** Postgres schema name for assistant chat tables (created by `drizzle/` migrations). */
export const ASSISTANT_DB_SCHEMA = "sealai_assistant";

/** Bucket key for threads created without an explicit kube namespace. */
export const DEFAULT_ASSISTANT_NAMESPACE_KEY = "__default__" as const;

/** Trim and bucket empty namespaces so they aggregate under one key. */
export function normalizeAssistantNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ASSISTANT_NAMESPACE_KEY;
}

/**
 * Server-verified owner of a personal Assistant Conversation. `userUid` is
 * stored in the legacy-named `workspace_actor` column (ADR-0059); the
 * per-region crName never enters uid-keyed conversation rows.
 */
export type AssistantConversationOwner = PersonalResourceOwner;

/**
 * Stable scope of one Project Assistant conversation. Ownership remains the
 * verified Workspace Actor; `projectId` prevents two Projects in the same
 * namespace from sharing thread history or a system-prompt identity.
 */
export interface AssistantConversationScope extends AssistantConversationOwner {
  projectId: string;
}

/**
 * A verified actor entering a conversation route. Conversation persistence
 * consults the crName only to find the actor's legacy rows; surfaces still
 * keyed by crName (the chat toolset's deploy-task actor) also read it from
 * here.
 */
export type VerifiedAssistantConversationActor = VerifiedPersonalResourceActor;

/** Wire shape for a thread row sent to the client. */
export interface AssistantThreadDTO {
  id: string;
  namespace: string;
  title: string;
  updatedAt: string;
}

export const assistantThreadDTOSchema = z.object({
  id: z.string(),
  namespace: z.string(),
  title: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AssistantThreadDTO>;

/**
 * What a `user` turn spends (CONTEXT.md): a subscribed workspace's AI
 * Credits, a Pay-As-You-Go workspace's Account Balance.
 */
export type ChatPaidSource = "ai-credits" | "balance";

/**
 * Why the next `user` turn is refused (ADR-0073): an exhausted Paid Source
 * (`ai-credits` | `balance`), or a subscription whose plan grants no AI
 * allowance at all — upstream refuses those turns unconditionally, and the
 * account balance is never consulted for a subscribed workspace. The
 * allowance causes fork on whether the workspace's Free Chat Turns story
 * explains the stop (`allowance-trial`: "free trial messages used up") or
 * the plan itself does (`allowance-plan`: "AI usage not included").
 */
export type ChatWallCause =
  | ChatPaidSource
  | "allowance-trial"
  | "allowance-plan";

/**
 * Read-side snapshot of a workspace's Chat Billing Posture, seeded into the
 * pane on load. Computed server-side only (ADR-0065/0069): bootstrap payload
 * and `X-Chat-*` headers agree; clients render, never derive.
 */
export interface FreeTierState {
  billing: "free" | "user";
  limit: number;
  /** The paid source the next `user` turn spends; absent/null while unknown. */
  paidSource?: ChatPaidSource | null;
  remaining: number;
  /**
   * The billing cause that refuses the next `user` turn (design spec row
   * E3, ADR-0073); absent/null while open. Every cause locks the composer
   * at once.
   */
  wall?: ChatWallCause | null;
}

/** Bootstrap payload returned by `GET /api/chat/session`. */
export interface AssistantSessionPayload {
  chatId: string;
  freeTier: FreeTierState;
  messages: UIMessage[];
  threads: AssistantThreadDTO[];
}

/**
 * Stable, per-thread project context prepended to the model system prompt.
 *
 * Only carries values that do not change within a thread (project name + id), so
 * the system prompt stays a byte-stable, cacheable prefix. The volatile canvas
 * selection is NOT here — it is pinned to individual user messages instead (see
 * {@link SelectedContextReference}).
 */
export const assistantContextPayloadSchema = z.object({
  projectName: z.string().max(512).optional(),
  projectId: z.string().trim().min(1).max(256),
});
export type AssistantContextPayload = z.infer<
  typeof assistantContextPayloadSchema
>;

/**
 * Snapshot of the resource selected on the canvas when a user message was sent.
 *
 * Pinned to that message as a typed `data-selectedContext` part so the model resolves
 * deictic references ("this" / "it") against the selection that was live at send
 * time — not whatever happens to be selected on a later request. Absence means
 * "nothing was selected"; we never backfill a stale target.
 */
export const selectedResourceContextSchema = z.object({
  /** Resource Display Name (ADR 0066) — display-only, never a `name` argument. */
  displayName: z.string().max(512).optional(),
  kind: z.string().max(128).optional(),
  name: z.string().max(512).optional(),
  namespace: z.string().max(256).optional(),
});
export type SelectedResourceContext = z.infer<
  typeof selectedResourceContextSchema
>;

/**
 * Typed, message-scoped reference captured from the UI when a user turn is sent.
 *
 * The reference is historical context, not live cluster state or an authority
 * token. `observedUid` distinguishes the selected Kubernetes object from a later
 * object recreated under the same name.
 */
export const selectedContextReferenceSchema = z
  .object({
    type: z.literal("resource"),
    /** Resource Display Name (ADR 0066), frozen at send time. */
    displayName: z.string().max(512).optional(),
    kind: z.enum(["AP", "DB", "PublicAccess"]),
    name: z.string().min(1).max(512),
    namespace: z.string().min(1).max(256),
    observedUid: z.string().min(1).max(512).optional(),
    /** Project identity captured with the message; absent only on legacy rows. */
    projectId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type SelectedContextReference = z.infer<
  typeof selectedContextReferenceSchema
>;

/** UIMessage part type carrying a typed {@link SelectedContextReference}. */
export const SELECTED_CONTEXT_PART_TYPE = "data-selectedContext" as const;

/** UIMessage part type carrying the legacy {@link SelectedResourceContext} on a user turn. */
export const SELECTED_RESOURCE_CONTEXT_PART_TYPE =
  "data-selectedResource" as const;

/**
 * Read and normalize the message-scoped Context Reference. New typed parts are
 * preferred; legacy `data-selectedResource` parts remain readable in place.
 */
export function readSelectedContextReference(
  message: UIMessage
): SelectedContextReference | null {
  let legacyReference: SelectedContextReference | null = null;
  for (const part of message.parts) {
    if (part.type === SELECTED_CONTEXT_PART_TYPE) {
      const parsed = selectedContextReferenceSchema.safeParse(
        (part as { data?: unknown }).data
      );
      if (parsed.success) {
        return parsed.data;
      }
      continue;
    }

    if (part.type !== SELECTED_RESOURCE_CONTEXT_PART_TYPE) {
      continue;
    }
    const parsed = selectedResourceContextSchema.safeParse(
      (part as { data?: unknown }).data
    );
    if (!parsed.success) {
      continue;
    }
    const { displayName, kind, name, namespace } = parsed.data;
    if (!(kind && name && namespace)) {
      continue;
    }
    const normalized = selectedContextReferenceSchema.safeParse({
      type: "resource",
      ...(displayName === undefined ? {} : { displayName }),
      kind,
      name,
      namespace,
    });
    if (normalized.success) {
      legacyReference ??= normalized.data;
    }
  }
  return legacyReference;
}

/** Read + validate the pinned selection from a message; `null` when absent or empty. */
export function readSelectedResourceContext(
  message: UIMessage
): SelectedResourceContext | null {
  const reference = readSelectedContextReference(message);
  if (reference == null) {
    return null;
  }
  return {
    ...(reference.displayName === undefined
      ? {}
      : { displayName: reference.displayName }),
    kind: reference.kind,
    name: reference.name,
    namespace: reference.namespace,
  };
}

/**
 * Body of `POST /api/chat`. A fresh `chatId` materializes lazily under the
 * verified Workspace Actor; existing ids are usable only by their owner.
 */
export const chatStreamRequestSchema = z.object({
  chatId: z.string().min(1).max(64),
  namespace: z.string(),
  message: z.unknown(),
  encodedKubeconfig: z.string().optional(),
  assistantContext: assistantContextPayloadSchema,
});
export type ChatStreamRequest = z.infer<typeof chatStreamRequestSchema> & {
  workspaceResourceQuota?: WorkspaceResourceQuotaSnapshot;
};

/** Body of `POST /api/chat/messages`. Used by UI event adapters. */
export const appendMessageBodySchema = z.object({
  chatId: z.string().min(1),
  message: z.unknown(),
  namespace: z.string(),
});

/** Server-side narrowing for the AI SDK `UIMessage` payloads we accept across the wire. */
export function isPersistedUIMessage(value: unknown): value is UIMessage {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    Array.isArray(m.parts)
  );
}

export function isAssistantApprovalResponseMessage(
  message: UIMessage
): boolean {
  return (
    message.role === "assistant" &&
    message.parts.some(
      (part) => isToolUIPart(part) && part.state === "approval-responded"
    )
  );
}

export function isAppendableAssistantEventMessage(message: UIMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.every((part) => part.type === "text")
  );
}

export function pendingApprovalIds(message: UIMessage): Set<string> {
  const ids = new Set<string>();
  if (message.role !== "assistant") {
    return ids;
  }
  for (const part of message.parts) {
    if (
      isToolUIPart(part) &&
      part.state === "approval-requested" &&
      typeof part.approval?.id === "string"
    ) {
      ids.add(part.approval.id);
    }
  }
  return ids;
}

export function respondedApprovalIds(message: UIMessage): Set<string> {
  const ids = new Set<string>();
  if (message.role !== "assistant") {
    return ids;
  }
  for (const part of message.parts) {
    if (
      isToolUIPart(part) &&
      part.state === "approval-responded" &&
      typeof part.approval?.id === "string"
    ) {
      ids.add(part.approval.id);
    }
  }
  return ids;
}

interface ComparableApprovalToolPart {
  approvalId: string;
  input: unknown;
  toolCallId: string;
  type: string;
}

interface ApprovalResponseDecision {
  approved: boolean;
  id: string;
  reason?: string;
}

function approvalObject(part: unknown): Record<string, unknown> | undefined {
  if (part == null || typeof part !== "object" || Array.isArray(part)) {
    return undefined;
  }
  const approval = (part as Record<string, unknown>).approval;
  if (
    approval == null ||
    typeof approval !== "object" ||
    Array.isArray(approval)
  ) {
    return undefined;
  }
  return approval as Record<string, unknown>;
}

function comparableApprovalToolParts(
  message: UIMessage,
  state: "approval-requested" | "approval-responded"
): Map<string, ComparableApprovalToolPart> {
  const parts = new Map<string, ComparableApprovalToolPart>();
  if (message.role !== "assistant") {
    return parts;
  }

  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.state !== state) {
      continue;
    }
    const approvalId = approvalObject(part)?.id;
    if (typeof approvalId !== "string" || typeof part.toolCallId !== "string") {
      continue;
    }
    parts.set(approvalId, {
      approvalId,
      input: part.input,
      toolCallId: part.toolCallId,
      type: part.type,
    });
  }

  return parts;
}

function unknownRecordsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (
    left == null ||
    right == null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right))) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => unknownRecordsEqual(item, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      unknownRecordsEqual(leftRecord[key], rightRecord[key])
  );
}

function approvalsMatchPendingToolParts(
  pending: UIMessage,
  candidate: UIMessage
): boolean {
  const pendingParts = comparableApprovalToolParts(
    pending,
    "approval-requested"
  );
  const responseParts = comparableApprovalToolParts(
    candidate,
    "approval-responded"
  );
  if (pendingParts.size === 0 || responseParts.size === 0) {
    return false;
  }

  for (const [approvalId, responsePart] of responseParts) {
    const pendingPart = pendingParts.get(approvalId);
    if (pendingPart == null) {
      return false;
    }
    if (
      responsePart.type !== pendingPart.type ||
      responsePart.toolCallId !== pendingPart.toolCallId ||
      !unknownRecordsEqual(responsePart.input, pendingPart.input)
    ) {
      return false;
    }
  }

  return true;
}

function approvalResponseDecisions(
  candidate: UIMessage
): Map<string, ApprovalResponseDecision> {
  const decisions = new Map<string, ApprovalResponseDecision>();
  if (candidate.role !== "assistant") {
    return decisions;
  }

  for (const part of candidate.parts) {
    if (!isToolUIPart(part) || part.state !== "approval-responded") {
      continue;
    }
    const approval = approvalObject(part);
    const approvalId = approval?.id;
    if (
      typeof approvalId === "string" &&
      typeof approval?.approved === "boolean" &&
      (approval.reason === undefined || typeof approval.reason === "string")
    ) {
      const decision: ApprovalResponseDecision = {
        approved: approval.approved,
        id: approvalId,
      };
      if (typeof approval.reason === "string") {
        decision.reason = approval.reason;
      }
      decisions.set(approvalId, decision);
    }
  }

  return decisions;
}

export function isApprovedContinuationOfPendingAssistantMessage(
  pending: UIMessage | undefined,
  candidate: UIMessage
): boolean {
  if (
    pending == null ||
    pending.id !== candidate.id ||
    pending.role !== "assistant" ||
    candidate.role !== "assistant"
  ) {
    return false;
  }

  const pendingIds = pendingApprovalIds(pending);
  if (pendingIds.size === 0) {
    return false;
  }

  const responseIds = respondedApprovalIds(candidate);
  if (responseIds.size === 0) {
    return false;
  }

  if (!approvalsMatchPendingToolParts(pending, candidate)) {
    return false;
  }

  for (const part of candidate.parts) {
    if (
      isToolUIPart(part) &&
      part.state === "approval-requested" &&
      part.approval?.id != null &&
      pendingIds.has(part.approval.id)
    ) {
      return false;
    }
  }

  return true;
}

export function buildAssistantApprovalResponseFromPending(
  pending: UIMessage | undefined,
  candidate: UIMessage
): UIMessage | undefined {
  if (!isApprovedContinuationOfPendingAssistantMessage(pending, candidate)) {
    return undefined;
  }
  if (pending == null) {
    return undefined;
  }
  const decisions = approvalResponseDecisions(candidate);
  return {
    ...pending,
    parts: pending.parts.map((part) => {
      if (
        !isToolUIPart(part) ||
        part.state !== "approval-requested" ||
        typeof part.approval?.id !== "string"
      ) {
        return part;
      }
      const decision = decisions.get(part.approval.id);
      if (decision == null) {
        return part;
      }
      return {
        ...part,
        approval: decision,
        state: "approval-responded",
      };
    }),
  };
}

function matchesPendingApprovalMessage(
  pending: UIMessage,
  candidate: UIMessage
): boolean {
  if (pending.role !== "assistant" || candidate.role !== "assistant") {
    return false;
  }

  const pendingIds = pendingApprovalIds(pending);
  if (pendingIds.size === 0) {
    return false;
  }

  const responseIds = respondedApprovalIds(candidate);
  if (responseIds.size === 0) {
    return false;
  }

  return approvalsMatchPendingToolParts(pending, candidate);
}

export function findPendingApprovalMessageForResponse(
  history: UIMessage[],
  candidate: UIMessage
): UIMessage | undefined {
  const sameMessage = history.find((item) =>
    isApprovedContinuationOfPendingAssistantMessage(item, candidate)
  );
  if (sameMessage != null) {
    return sameMessage;
  }

  const matches = history.filter((item) =>
    matchesPendingApprovalMessage(item, candidate)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

const CLIENT_TOOL_PART_TYPES = [
  `tool-${NAVIGATE_APP_TOOL_NAME}`,
  `tool-${OPEN_PROJECT_SURFACE_TOOL_NAME}`,
  `tool-${REFRESH_FRONTEND_SWR_TOOL_NAME}`,
] as const;

type ClientToolPartType = (typeof CLIENT_TOOL_PART_TYPES)[number];
type UIMessagePart = UIMessage["parts"][number];

const CLIENT_TOOL_ERROR_TEXT_MAX_LENGTH = 500;
const clientToolErrorTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(CLIENT_TOOL_ERROR_TEXT_MAX_LENGTH);

const approvalResponseDecisionSchema = z
  .object({
    approved: z.boolean(),
    id: z.string().min(1),
    reason: z.string().max(CLIENT_TOOL_ERROR_TEXT_MAX_LENGTH).optional(),
  })
  .strict();

export const INCOMPLETE_CLIENT_TOOL_RECOVERY_ERROR =
  "The browser tool result was not persisted. The browser action was not replayed during recovery.";

function isClientToolPartType(type: string): type is ClientToolPartType {
  return (CLIENT_TOOL_PART_TYPES as readonly string[]).includes(type);
}

function parseCanonicalClientToolOutput(
  type: ClientToolPartType,
  output: unknown
): { output: unknown; success: true } | { success: false } {
  switch (type) {
    case `tool-${NAVIGATE_APP_TOOL_NAME}`: {
      const parsed = navigateAppOutputSchema.safeParse(output);
      return parsed.success
        ? { output: parsed.data, success: true }
        : { success: false };
    }
    case `tool-${OPEN_PROJECT_SURFACE_TOOL_NAME}`: {
      const parsed = openProjectSurfaceOutputSchema.safeParse(output);
      return parsed.success
        ? { output: parsed.data, success: true }
        : { success: false };
    }
    case `tool-${REFRESH_FRONTEND_SWR_TOOL_NAME}`: {
      const parsed = refreshFrontendSwrCachesOutputSchema.safeParse(output);
      return parsed.success
        ? { output: parsed.data, success: true }
        : { success: false };
    }
    default:
      return { success: false };
  }
}

/** True when a candidate carries a terminal result for a whitelisted browser tool. */
export function hasClientToolResultContinuation(message: UIMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.some(
      (part) =>
        isToolUIPart(part) &&
        isClientToolPartType(part.type) &&
        (part.state === "output-available" || part.state === "output-error")
    )
  );
}

function hasPendingClientToolCall(message: UIMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.some(
      (part) =>
        isToolUIPart(part) &&
        isClientToolPartType(part.type) &&
        part.providerExecuted !== true &&
        part.state === "input-available"
    )
  );
}

/** Lightweight routing predicate; the canonical builder performs authoritative validation. */
export function isAssistantContinuationMessage(message: UIMessage): boolean {
  return (
    message.role === "assistant" &&
    (hasClientToolResultContinuation(message) ||
      isAssistantApprovalResponseMessage(message))
  );
}

interface RebuiltContinuationPart {
  part: UIMessagePart;
  progressed: boolean;
}

function rebuildClientToolResultPart(
  pending: UIMessagePart,
  candidate: UIMessagePart
): RebuiltContinuationPart | undefined {
  if (
    !(
      isToolUIPart(pending) &&
      isToolUIPart(candidate) &&
      isClientToolPartType(pending.type)
    ) ||
    pending.state !== "input-available" ||
    (candidate.state !== "output-available" &&
      candidate.state !== "output-error") ||
    candidate.type !== pending.type ||
    candidate.toolCallId !== pending.toolCallId ||
    candidate.providerExecuted !== pending.providerExecuted ||
    !unknownRecordsEqual(candidate.input, pending.input)
  ) {
    return undefined;
  }

  if (candidate.state === "output-available") {
    const parsed = parseCanonicalClientToolOutput(
      pending.type,
      candidate.output
    );
    if (!parsed.success || "errorText" in candidate) {
      return undefined;
    }
    return {
      part: {
        ...pending,
        output: parsed.output,
        state: "output-available",
      } as UIMessagePart,
      progressed: true,
    };
  }

  const parsedError = clientToolErrorTextSchema.safeParse(candidate.errorText);
  if (!parsedError.success || "output" in candidate) {
    return undefined;
  }
  return {
    part: {
      ...pending,
      errorText: parsedError.data,
      state: "output-error",
    } as UIMessagePart,
    progressed: true,
  };
}

function rebuildApprovalResponsePart(
  pending: UIMessagePart,
  candidate: UIMessagePart
): RebuiltContinuationPart | undefined {
  if (
    !(isToolUIPart(pending) && isToolUIPart(candidate)) ||
    pending.state !== "approval-requested" ||
    candidate.state !== "approval-responded" ||
    candidate.type !== pending.type ||
    candidate.toolCallId !== pending.toolCallId ||
    candidate.providerExecuted !== pending.providerExecuted ||
    !unknownRecordsEqual(candidate.input, pending.input) ||
    "output" in candidate ||
    "errorText" in candidate
  ) {
    return undefined;
  }

  const parsedDecision = approvalResponseDecisionSchema.safeParse(
    approvalObject(candidate)
  );
  if (
    !parsedDecision.success ||
    parsedDecision.data.id !== pending.approval.id
  ) {
    return undefined;
  }

  return {
    part: {
      ...pending,
      approval: parsedDecision.data,
      state: "approval-responded",
    } as UIMessagePart,
    progressed: true,
  };
}

function completedClientToolPartsMatch(
  pending: UIMessagePart,
  candidate: UIMessagePart
): boolean {
  if (!(isToolUIPart(pending) && isToolUIPart(candidate))) {
    return false;
  }
  if (
    !isClientToolPartType(pending.type) ||
    pending.type !== candidate.type ||
    pending.state !== "output-available" ||
    candidate.state !== "output-available"
  ) {
    return false;
  }

  const pendingOutput = parseCanonicalClientToolOutput(
    pending.type,
    pending.output
  );
  const candidateOutput = parseCanonicalClientToolOutput(
    pending.type,
    candidate.output
  );
  return (
    pendingOutput.success &&
    candidateOutput.success &&
    unknownRecordsEqual(
      { ...pending, output: pendingOutput.output },
      { ...candidate, output: candidateOutput.output }
    )
  );
}

function completedServerToolPartsMatch(
  pending: UIMessagePart,
  candidate: UIMessagePart
): boolean {
  if (
    !(isToolUIPart(pending) && isToolUIPart(candidate)) ||
    isClientToolPartType(pending.type) ||
    (pending.state !== "output-available" &&
      pending.state !== "output-error" &&
      pending.state !== "output-denied")
  ) {
    return false;
  }

  return unknownRecordsEqual(
    { ...pending, toolMetadata: undefined },
    { ...candidate, toolMetadata: undefined }
  );
}

function rebuildContinuationPart(
  pending: UIMessagePart,
  candidate: UIMessagePart
): RebuiltContinuationPart | undefined {
  if (pending.type !== candidate.type) {
    return undefined;
  }

  const clientResult = rebuildClientToolResultPart(pending, candidate);
  if (clientResult != null) {
    return clientResult;
  }

  const approvalResponse = rebuildApprovalResponsePart(pending, candidate);
  if (approvalResponse != null) {
    return approvalResponse;
  }

  if (completedClientToolPartsMatch(pending, candidate)) {
    return { part: pending, progressed: false };
  }

  if (completedServerToolPartsMatch(pending, candidate)) {
    return { part: pending, progressed: false };
  }

  return unknownRecordsEqual(pending, candidate)
    ? { part: pending, progressed: false }
    : undefined;
}

function hasIncompleteNonProviderToolInLastStep(message: UIMessage): boolean {
  const lastStepStartIndex = message.parts.reduce(
    (lastIndex, part, index) =>
      part.type === "step-start" ? index : lastIndex,
    -1
  );

  return message.parts.slice(lastStepStartIndex + 1).some((part) => {
    if (!isToolUIPart(part) || part.providerExecuted === true) {
      return false;
    }
    return !(
      part.state === "approval-responded" ||
      part.state === "output-available" ||
      part.state === "output-denied" ||
      part.state === "output-error"
    );
  });
}

/**
 * Rebuild an assistant continuation from the stored pending message.
 *
 * Candidate text, metadata, tool inputs, and server-tool results are never
 * persisted. Only validated browser-tool results and approval decisions can
 * advance their corresponding stored parts.
 */
export function buildAssistantContinuationFromPending(
  pending: UIMessage | undefined,
  candidate: UIMessage
): UIMessage | undefined {
  if (
    pending == null ||
    pending.id !== candidate.id ||
    pending.role !== "assistant" ||
    candidate.role !== "assistant" ||
    pending.parts.length !== candidate.parts.length
  ) {
    return undefined;
  }

  let progressed = false;
  const parts: UIMessagePart[] = [];
  for (const [index, pendingPart] of pending.parts.entries()) {
    const candidatePart = candidate.parts[index];
    if (candidatePart == null) {
      return undefined;
    }
    const rebuilt = rebuildContinuationPart(pendingPart, candidatePart);
    if (rebuilt == null) {
      return undefined;
    }
    progressed ||= rebuilt.progressed;
    parts.push(rebuilt.part);
  }

  if (!progressed) {
    return undefined;
  }

  const rebuilt: UIMessage = { ...pending, parts };
  return hasIncompleteNonProviderToolInLastStep(rebuilt) ? undefined : rebuilt;
}

/**
 * Locate the stored message a continuation may advance.
 *
 * Browser-tool results must keep the server message id. Pure approval payloads
 * retain the existing unique approval-id recovery for older clients that mint a
 * replacement message id.
 */
export function findPendingAssistantMessageForContinuation(
  history: UIMessage[],
  candidate: UIMessage
): UIMessage | undefined {
  if (hasClientToolResultContinuation(candidate)) {
    const sameMessage = history.find(
      (message) => message.role === "assistant" && message.id === candidate.id
    );
    if (
      sameMessage != null &&
      (hasPendingClientToolCall(sameMessage) ||
        isAssistantApprovalResponseMessage(candidate))
    ) {
      return sameMessage;
    }
    return undefined;
  }
  return findPendingApprovalMessageForResponse(history, candidate);
}

/**
 * Build a CAS replacement for legacy messages whose browser result was lost.
 * The helper never executes or replays the browser action.
 */
export function buildRecoveredAssistantMessageForIncompleteClientTools(
  message: UIMessage
): UIMessage | undefined {
  if (message.role !== "assistant") {
    return undefined;
  }

  let recovered = false;
  const parts = message.parts.map((part): UIMessagePart => {
    if (
      !(isToolUIPart(part) && isClientToolPartType(part.type)) ||
      part.providerExecuted === true ||
      part.state !== "input-available"
    ) {
      return part;
    }
    recovered = true;
    return {
      ...part,
      errorText: INCOMPLETE_CLIENT_TOOL_RECOVERY_ERROR,
      state: "output-error",
    } as UIMessagePart;
  });

  return recovered ? { ...message, parts } : undefined;
}

const INTERRUPTED_TOOL_RECOVERY_ERROR =
  "Tool execution was interrupted before a result was available.";

/**
 * Close tool states that can remain after a process dies mid-continuation.
 * The recovery never retries an approved side effect.
 */
export function buildRecoveredAssistantMessageForInterruptedTools(
  message: UIMessage
): UIMessage | undefined {
  if (message.role !== "assistant") {
    return undefined;
  }

  let recovered = false;
  const parts = message.parts.map((part): UIMessagePart => {
    if (
      isToolUIPart(part) &&
      part.providerExecuted !== true &&
      part.state === "input-available"
    ) {
      recovered = true;
      return {
        ...part,
        errorText: isClientToolPartType(part.type)
          ? INCOMPLETE_CLIENT_TOOL_RECOVERY_ERROR
          : INTERRUPTED_TOOL_RECOVERY_ERROR,
        state: "output-error",
      } as UIMessagePart;
    }

    if (
      !isToolUIPart(part) ||
      part.providerExecuted === true ||
      part.state !== "approval-responded"
    ) {
      return part;
    }

    recovered = true;
    return part.approval.approved
      ? ({
          ...part,
          errorText: INTERRUPTED_TOOL_RECOVERY_ERROR,
          state: "output-error",
        } as UIMessagePart)
      : ({ ...part, state: "output-denied" } as UIMessagePart);
  });

  return recovered ? { ...message, parts } : undefined;
}
