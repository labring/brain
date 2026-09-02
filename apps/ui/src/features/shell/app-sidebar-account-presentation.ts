import type { WorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";

export type AppSidebarAccountBadge =
  | { kind: "payg" }
  | { kind: "plan"; planName: string };

export interface AppSidebarAccountHint {
  text: string;
  tone: "danger" | "warn";
}

/**
 * What the account row shows for the Workspace Subscription: the badge slot
 * on the right and, for attention states, the hint that replaces the user-ID
 * second line (AIM-308). Quiet states carry no hint.
 */
export interface AppSidebarAccountPresentation {
  badge: AppSidebarAccountBadge | null;
  hint: AppSidebarAccountHint | null;
}

const HINT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

const DAY_MS = 24 * 60 * 60 * 1000;

function parsedDate(iso: string): Date | null {
  if (iso.trim() === "") {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function deriveAppSidebarAccountPresentation(
  summary: WorkspaceSubscriptionSummary | null,
  now: Date
): AppSidebarAccountPresentation {
  if (summary == null) {
    return { badge: null, hint: null };
  }
  if (summary.isPayg) {
    return { badge: { kind: "payg" }, hint: null };
  }
  const planName = summary.planName.trim();
  const badge = planName === "" ? null : ({ kind: "plan", planName } as const);
  if (summary.lifecycle === "payment-due") {
    return {
      badge,
      hint: { text: "Payment due · service limited", tone: "danger" },
    };
  }
  // Born paused with no trial (ADR-0074): suspended, but nothing expired.
  if (summary.isPaused) {
    return {
      badge,
      hint: { text: "No active plan · service limited", tone: "danger" },
    };
  }
  if (summary.lifecycle === "cancelling") {
    const endsAt = parsedDate(summary.currentPeriodEndAt);
    return {
      badge,
      hint:
        endsAt == null
          ? null
          : {
              text: `Ends ${HINT_DATE_FORMATTER.format(endsAt)}`,
              tone: "warn",
            },
    };
  }
  if (summary.isActiveFreeTrial) {
    const endsAt = parsedDate(summary.currentPeriodEndAt);
    if (endsAt != null) {
      const days = Math.max(
        0,
        Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)
      );
      return {
        badge,
        hint: {
          text: `Trial · ${days} ${days === 1 ? "day" : "days"} left`,
          tone: "warn",
        },
      };
    }
  }
  return { badge, hint: null };
}
