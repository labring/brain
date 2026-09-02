import type { ChatBillingDestination } from "./chat-billing-cards";
import type { ChatPaidSource, ChatWallCause } from "./persistence/types";

/**
 * A paid turn the AI proxy refused for billing reasons (design spec row
 * E3): what the pane learned from the failed request, so the error card can
 * say why instead of "something went wrong on our side". Pure — shared by
 * the pane's `onError` and the card copy.
 */
export interface ChatBillingInterruption {
  /**
   * Set when the refusal named a missing AI allowance (ADR-0073): the
   * workspace's plan grants no AI usage at all, forked on whether the Free
   * Chat Turns story explains the stop.
   */
  allowance?: "plan" | "trial" | null;
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
  const detailRecord =
    typeof detail === "object" && detail != null
      ? (detail as { allowance?: unknown; paidSource?: unknown })
      : null;
  if (code === "ai_allowance_missing") {
    return {
      allowance: detailRecord?.allowance === "trial" ? "trial" : "plan",
      paidSource: null,
    };
  }
  const named = paidSourceFrom(detailRecord?.paidSource);
  return { paidSource: named ?? knownPaidSource };
}

/** The two allowance wall causes (ADR-0073), narrowed for staging. */
export function chatAllowanceWall(
  wall: ChatWallCause | null | undefined
): "allowance-plan" | "allowance-trial" | null {
  return wall === "allowance-plan" || wall === "allowance-trial" ? wall : null;
}

/**
 * Whether the composer's message path is locked (ADR-0068, revised by
 * ADR-0073): an exhausted Paid Source locks immediately, while an
 * `allowance-*` wall stages — the advisory notice leaves the composer open,
 * and the lock lands only once a send was actually refused (the
 * interruption carries the refusal).
 */
export function chatMessagingLocked(
  wall: ChatWallCause | null | undefined,
  interruption: ChatBillingInterruption | null
): boolean {
  if (wall === "ai-credits" || wall === "balance") {
    return true;
  }
  if (chatAllowanceWall(wall) != null) {
    return interruption?.allowance != null;
  }
  return false;
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

/**
 * The advisory notice's copy (ADR-0073): the same cause the wall would
 * name, spoken before any send was refused — so the composer stays open and
 * the user learns what the next send runs into.
 */
export function chatBillingNoticeCopy(
  cause: "allowance-plan" | "allowance-trial",
  limit: number
): ChatBillingCopy {
  if (cause === "allowance-trial") {
    return {
      body: `This workspace has used all ${limit} free trial messages. Upgrade the plan to keep chatting.`,
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title: "Free trial messages used up",
    };
  }
  return {
    body: "This workspace's plan doesn't include AI usage. Upgrade the plan to use the assistant.",
    cta: { destination: "upgrade", label: "Upgrade plan" },
    title: "AI usage not included",
  };
}

/** The billing-ized error card's copy; an unknown source never claims one. */
export function chatBillingInterruptionCopy(
  interruption: ChatBillingInterruption | null
): ChatBillingCopy {
  if (interruption?.allowance != null) {
    return {
      body: "The turn was refused because this workspace's plan doesn't include AI usage. Upgrade the plan to continue.",
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title:
        interruption.allowance === "trial"
          ? "Message not sent — free trial messages used up"
          : "Message not sent — AI usage not included",
    };
  }
  const paidSource = interruption?.paidSource ?? null;
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
