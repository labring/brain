/**
 * Single helper for the JSON error envelope returned by `/api/chat*` routes.
 * Every chat API error shares the `{ code, error }` shape (ADR-0065): the
 * `code` is the response's formal identity for tests and non-browser callers.
 */

import type { WorkspaceActorAuthFailureCode } from "@/lib/request-kubeconfig-auth";

/** Every `code` the chat API's error envelope may carry (ADR-0065). */
export type ChatApiErrorCode =
  | WorkspaceActorAuthFailureCode
  | "account_balance_exhausted"
  | "ai_allowance_missing"
  | "ai_connection_unavailable"
  | "ai_credits_exhausted"
  | "ai_proxy_billing_refused"
  | "assistant_chat_unavailable"
  | "assistant_conversation_not_found"
  | "assistant_project_not_found"
  | "assistant_project_unavailable"
  | "assistant_thread_conflict"
  | "assistant_turn_in_progress"
  | "incomplete_tool_history"
  | "invalid_request"
  | "stale_assistant_continuation"
  | "tool_approval_pending";

export interface ChatApiErrorBody {
  code: ChatApiErrorCode;
  detail?: unknown;
  error: string;
}

export function jsonError(
  code: ChatApiErrorCode,
  message: string,
  status: number,
  detail?: unknown
): Response {
  const body: ChatApiErrorBody =
    detail === undefined
      ? { code, error: message }
      : { code, detail, error: message };
  return Response.json(body, { status });
}
