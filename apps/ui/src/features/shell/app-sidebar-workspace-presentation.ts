import type { WorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";

export type WorkspaceSwitcherBadge =
  | { kind: "payg" }
  | { kind: "plan"; planName: string };

export interface WorkspaceSwitcherHint {
  text: string;
  tone: "danger" | "warn";
}

/**
 * What the Workspace Switcher row shows for the current Workspace
 * Subscription (spec §C.3): the badge slot on the right and, for attention
 * states (payment-due, cancelling, an ending trial), the hint that grows the
 * row to two lines. Quiet states carry no hint. The plan is a Workspace
 * fact, so this lives on the Switcher row and never on the account row.
 */
export interface WorkspaceSwitcherPresentation {
  badge: WorkspaceSwitcherBadge | null;
  hint: WorkspaceSwitcherHint | null;
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

export function deriveWorkspaceSwitcherPresentation(
  summary: WorkspaceSubscriptionSummary | null,
  now: Date
): WorkspaceSwitcherPresentation {
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
