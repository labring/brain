import {
  type AiCredits,
  aiCreditsPercentUsed,
  formatAiCredits,
} from "@/features/billing/billing-ai-credits";
import type { FreeChatTurnsUsage } from "@/features/chat/persistence/client";
import type { AppSidebarQuotaRow } from "@/features/shell/app-sidebar-quota";

/** The AI slot's user-visible labels — the popover skeleton reuses them. */
export const FREE_TRIAL_MESSAGES_ROW_LABEL = "Free trial messages";
export const AI_CREDITS_ROW_LABEL = "AI Credits";

/**
 * The account popover's AI usage row — the Billing Plan view's credits slot
 * (ADR-0065) in sidebar form: an Active Free Trial shows Free Chat Turns
 * under their user-visible "Free trial messages" label, any other Workspace
 * Subscription shows AI Credits, PAYG shows nothing. `null` omits the row.
 */
export function aiUsageRowFromFreeTurns(
  usage: FreeChatTurnsUsage
): AppSidebarQuotaRow | null {
  if (
    !(Number.isFinite(usage.used) && Number.isFinite(usage.limit)) ||
    usage.limit <= 0
  ) {
    return null;
  }
  const used = Math.max(0, usage.used);
  return {
    label: FREE_TRIAL_MESSAGES_ROW_LABEL,
    percent: Math.min(100, (used / usage.limit) * 100),
    value: `${used}/${usage.limit}`,
  };
}

/** `null` when the plan grants no AI Credits (a zero `hard` allowance). */
export function aiUsageRowFromCredits(
  credits: AiCredits
): AppSidebarQuotaRow | null {
  if (credits.totalMicroUnits <= 0) {
    return null;
  }
  return {
    label: AI_CREDITS_ROW_LABEL,
    percent: aiCreditsPercentUsed(
      credits.usedMicroUnits,
      credits.totalMicroUnits
    ),
    value: `${formatAiCredits(credits.usedMicroUnits)}/${formatAiCredits(
      credits.totalMicroUnits
    )}`,
  };
}
