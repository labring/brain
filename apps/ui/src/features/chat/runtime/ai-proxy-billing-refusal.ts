import { APICallError } from "ai";

import type { ChatPaidSource } from "@/features/chat/persistence/types";

import type { ChatApiErrorBody } from "./errors";

/**
 * aiproxy refuses a group whose balance is exhausted with a 403 whose body
 * is typed `group_balance_not_enough` ("group `<id>` balance not enough").
 * The signal already reaches Brain on the token request and mid-stream; this
 * is the missing classification (design spec row E3). Everything else stays
 * masked — upstream error text is never echoed to the browser.
 */

const AI_PROXY_BILLING_REFUSAL_TYPE = "group_balance_not_enough";
const AI_PROXY_BILLING_REFUSAL_MESSAGE = /balance not enough/i;

/** The AI SDK's own masked default, kept verbatim so nothing leaks. */
export const MASKED_STREAM_ERROR_TEXT = "An error occurred.";

export const AI_PROXY_BILLING_REFUSED_MESSAGE =
  "The AI proxy refused this turn for billing reasons.";

export function isAiProxyBillingRefusal(input: {
  bodyText: string | undefined;
  status: number | undefined;
}): boolean {
  if (input.status !== 403) {
    return false;
  }
  const body = input.bodyText ?? "";
  if (body.includes(AI_PROXY_BILLING_REFUSAL_TYPE)) {
    return true;
  }
  return AI_PROXY_BILLING_REFUSAL_MESSAGE.test(body);
}

/**
 * What a refusal body names: the paid source the pane's card speaks to,
 * and the owner-balance wall when the balance is a Workspace Owner's the
 * actor is not proven to be (ADR-0082) — the card then asks, no top-up.
 */
export interface AiProxyRefusalVoice {
  paidSource: ChatPaidSource | null;
  wall?: "owner-balance";
}

export function aiProxyBillingRefusedBody(
  voice: AiProxyRefusalVoice | ChatPaidSource | null
): ChatApiErrorBody {
  const detail: AiProxyRefusalVoice =
    typeof voice === "object" && voice != null ? voice : { paidSource: voice };
  return {
    code: "ai_proxy_billing_refused",
    detail,
    error: AI_PROXY_BILLING_REFUSED_MESSAGE,
  };
}

/**
 * The `onError` mapper for the UI message stream: a mid-stream aiproxy
 * billing refusal becomes the structured refusal body (as text — the stream
 * protocol carries one string) so the pane can read it; every other error
 * is masked.
 */
export function chatStreamErrorText(
  error: unknown,
  voice: AiProxyRefusalVoice | ChatPaidSource | null
): string {
  if (
    APICallError.isInstance(error) &&
    isAiProxyBillingRefusal({
      bodyText: error.responseBody ?? error.message,
      status: error.statusCode,
    })
  ) {
    return JSON.stringify(aiProxyBillingRefusedBody(voice));
  }
  return MASKED_STREAM_ERROR_TEXT;
}
