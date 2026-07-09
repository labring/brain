import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

/** Postgres schema name for assistant chat tables (created by `drizzle/` migrations). */
export const ASSISTANT_DB_SCHEMA = "sealai_assistant";

/** Bucket key for threads created without an explicit kube namespace. */
export const DEFAULT_ASSISTANT_NAMESPACE_KEY = "__default__" as const;

/** Trim and bucket empty namespaces so they aggregate under one key. */
export function normalizeAssistantNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ASSISTANT_NAMESPACE_KEY;
}

/** Max length for a client-supplied owner tag (matches the GitHub identity cap). */
const MAX_ASSISTANT_OWNER_LEN = 256;

/**
 * Normalize the client-supplied owner tag (Sealos `session.user.id`): trimmed and
 * length-capped. An empty string is the shared / no-identity bucket. This value is
 * NOT authenticated — it is a default-view partition, not a security boundary
 * (ADR 0047).
 */
export function normalizeAssistantOwner(userId: string): string {
  return userId.trim().slice(0, MAX_ASSISTANT_OWNER_LEN);
}

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

/** Read-side snapshot of a namespace's chat billing posture, seeded into the pane on load. */
export interface FreeTierState {
  billing: "free" | "user";
  limit: number;
  remaining: number;
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
 * {@link SelectedResourceContext}).
 */
export const assistantContextPayloadSchema = z.object({
  projectName: z.string().max(512).optional(),
  projectId: z.string().max(256).optional(),
});
export type AssistantContextPayload = z.infer<
  typeof assistantContextPayloadSchema
>;

/**
 * Snapshot of the resource selected on the canvas when a user message was sent.
 *
 * Pinned to that message as a `data-selectedResource` part so the model resolves
 * deictic references ("this" / "it") against the selection that was live at send
 * time — not whatever happens to be selected on a later request. Absence means
 * "nothing was selected"; we never backfill a stale target.
 */
export const selectedResourceContextSchema = z.object({
  kind: z.string().max(128).optional(),
  name: z.string().max(512).optional(),
  namespace: z.string().max(256).optional(),
});
export type SelectedResourceContext = z.infer<
  typeof selectedResourceContextSchema
>;

/** UIMessage part type carrying {@link SelectedResourceContext} on a user turn. */
export const SELECTED_RESOURCE_CONTEXT_PART_TYPE =
  "data-selectedResource" as const;

/** Read + validate the pinned selection from a message; `null` when absent or empty. */
export function readSelectedResourceContext(
  message: UIMessage
): SelectedResourceContext | null {
  for (const part of message.parts) {
    if (part.type !== SELECTED_RESOURCE_CONTEXT_PART_TYPE) {
      continue;
    }
    const parsed = selectedResourceContextSchema.safeParse(
      (part as { data?: unknown }).data
    );
    if (!parsed.success) {
      continue;
    }
    const ctx = parsed.data;
    if (ctx.kind || ctx.name || ctx.namespace) {
      return ctx;
    }
  }
  return null;
}

/** Body of `POST /api/chat`. */
export const chatStreamRequestSchema = z.object({
  chatId: z.string().min(1),
  namespace: z.string(),
  message: z.unknown(),
  encodedKubeconfig: z.string().optional(),
  assistantContext: assistantContextPayloadSchema.optional(),
});
export type ChatStreamRequest = z.infer<typeof chatStreamRequestSchema>;

/** Body of `POST /api/chat/thread`. */
export const createThreadBodySchema = z.object({
  namespace: z.string().optional(),
  /** Owner tag (`session.user.id`) the new thread is created under; see {@link normalizeAssistantOwner}. */
  userId: z.string().optional(),
});

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
