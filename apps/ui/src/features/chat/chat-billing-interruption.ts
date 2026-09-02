import type { ChatBillingDestination } from "./chat-billing-cards";
import type { ChatPaidSource, ChatWallCause } from "./persistence/types";

/**
 * A paid turn the AI proxy refused for billing reasons (design spec row
 * E3): what the pane learned from the failed request, so the error card can
 * say why instead of "something went wrong on our side". Pure — shared by
 * the pane's `onError` and the card copy.
 */
export interface ChatBillingInterruption {
  /** The paid source the refusal named, else the pane's own; null when neither is known. */
  paidSource: ChatPaidSource | null;
}

export interface ChatBillingCopy {
  body: string;
  cta: { destination: ChatBillingDestination; label: string };
  title: string;
}

const BILLING_REFUSAL_CODES = new Set([
  "account_balance_exhausted",
  "ai_allowance_missing",
  "ai_credits_exhausted",
  "ai_proxy_billing_refused",
]);

function paidSourceFrom(value: unknown): ChatPaidSource | null {
  return value === "ai-credits" || value === "balance" ? value : null;
}

/**
 * Reads the chat API's `{ code, error, detail }` envelope out of the error
 * `useChat` reports — the body text of a refused request, or the error text
 * a mid-stream refusal carried. Null for anything that is not a billing
 * refusal.
 */
export function chatBillingInterruptionFromError(
  error: Error,
  knownPaidSource: ChatPaidSource | null
): ChatBillingInterruption | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null) {
    return null;
  }
  const { code, detail } = parsed as { code?: unknown; detail?: unknown };
  if (typeof code !== "string" || !BILLING_REFUSAL_CODES.has(code)) {
    return null;
  }
  if (code === "account_balance_exhausted") {
    return { paidSource: "balance" };
  }
  if (code === "ai_credits_exhausted") {
    return { paidSource: "ai-credits" };
  }
  if (code === "ai_allowance_missing") {
    // A plan without an AI allowance names no Paid Source to spend
    // (ADR-0073); the `X-Chat-Wall` header on the same response carries
    // the cause and locks the composer.
    return { paidSource: null };
  }
  const named =
    typeof detail === "object" && detail != null
      ? paidSourceFrom((detail as { paidSource?: unknown }).paidSource)
      : null;
  return { paidSource: named ?? knownPaidSource };
}

/** The pre-send wall card's copy, forked by the refusing cause. */
export function chatBillingWallCopy(cause: ChatWallCause): ChatBillingCopy {
  if (cause === "allowance-trial") {
    return {
      body: "This workspace's plan doesn't include AI usage. Upgrade the plan to keep chatting.",
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title: "Free trial messages used up",
    };
  }
  if (cause === "allowance-plan") {
    return {
      body: "This workspace's plan doesn't include AI usage. Upgrade the plan to keep chatting.",
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title: "AI usage not included",
    };
  }
  if (cause === "ai-credits") {
    return {
      body: "This workspace's AI Credits are exhausted. Upgrade the plan to keep chatting.",
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title: "AI Credits used up",
    };
  }
  return {
    body: "Chat is paused because your account balance can't cover AI usage. Top up to continue.",
    cta: { destination: "top-up", label: "Top up balance" },
    title: "Account balance in debt",
  };
}

/** The billing-ized error card's copy; an unknown source never claims one. */
export function chatBillingInterruptionCopy(
  paidSource: ChatPaidSource | null
): ChatBillingCopy {
  if (paidSource === "ai-credits") {
    return {
      body: "The reply stopped because this workspace's AI Credits ran out. Upgrade the plan to continue.",
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title: "Message not sent — AI Credits used up",
    };
  }
  if (paidSource === "balance") {
    return {
      body: "The reply stopped because your account balance can't cover AI usage. Top up to continue.",
      cta: { destination: "top-up", label: "Top up balance" },
      title: "Message not sent — account balance in debt",
    };
  }
  return {
    body: "The AI proxy refused this turn for billing reasons. Check your plan or balance to continue.",
    cta: { destination: "plans", label: "View billing" },
    title: "Message not sent — billing refused the request",
  };
}

/** The locked composer's placeholder while the wall holds. */
export const CHAT_WALL_PLACEHOLDER =
  "Chat is paused — resolve billing to continue";

/** The locked placeholder, naming the allowance cause when it is the lock. */
export function chatWallPlaceholder(
  wall: ChatWallCause | null | undefined
): string {
  if (wall === "allowance-trial") {
    return "Free trial messages used up — upgrade to continue";
  }
  if (wall === "allowance-plan") {
    return "AI usage not included — upgrade to continue";
  }
  return CHAT_WALL_PLACEHOLDER;
}
