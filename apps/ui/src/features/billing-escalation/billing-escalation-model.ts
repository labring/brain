import type { BillingCta } from "@/features/billing/billing-cta";
import type { WorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import {
  CR_OVERRIDES,
  TOP_UP_BALANCE,
} from "@/features/notifications/cr-overrides";
import {
  type AppNotification,
  isNotificationUnread,
} from "@/features/shell/app-sidebar-notifications-model";
import {
  formatStatusHintDeadline,
  paymentDueCta,
} from "@/features/status-hint/status-hint-model";

/**
 * The Billing Escalation Dialog's model (CONTEXT.md, Notifications): which
 * platform Notification, if any, announces a step up the debt ladder right
 * now, which older stages its dismissal marks read with it, and the words
 * and fix the dialog shows for it. Pure — the hook feeds it the merged feed,
 * the session's read ids, and the Account Debt verdict the Status Hint and
 * the Deploy Billing Notice share.
 */

/** The platform's two debt ladders, told apart by the fixed CR name. */
export type BillingLadder = "account" | "workspace";

const ACCOUNT_LADDER_PREFIX = "debt-choice-";
const WORKSPACE_LADDER_PREFIX = "workspace-debt-";

export function billingLadderOf(
  crName: string | undefined
): BillingLadder | null {
  if (crName == null) {
    return null;
  }
  if (crName.startsWith(ACCOUNT_LADDER_PREFIX)) {
    return "account";
  }
  if (crName.startsWith(WORKSPACE_LADDER_PREFIX)) {
    return "workspace";
  }
  return null;
}

export interface BillingEscalationSelectionInput {
  /**
   * Whether Account Debt suspends this workspace — `accountDebtHolds`'s
   * verdict; null while unknown, which drops the account ladder (fail quiet).
   */
  accountDebt: boolean | null;
  items: readonly AppNotification[];
  /** Optimistic session reads layered over the items' own unread state. */
  readIds: ReadonlySet<string>;
}

export interface BillingEscalationSelection {
  /** The one stage to announce: the newest candidate. */
  announced: AppNotification;
  ladder: BillingLadder;
  /**
   * Every other unread stage of the same ladder — the older ones, and a
   * peer written in the same second that the id tie-break passed over —
   * read along with the announced one: a newer stage supersedes them, so
   * the inbox must not keep an unread count for what the dialog already
   * told, and no candidate is left behind to reopen the dialog after a
   * dismissal.
   */
  superseded: AppNotification[];
}

interface Candidate {
  item: AppNotification;
  ladder: BillingLadder;
}

/**
 * A candidate is a platform-origin item carrying the popup flag, unread
 * after receipts and session reads, of critical Severity (the Severity rule
 * already maps the ladders from the suspension stage on; the low-balance
 * tiers are warning and never qualify), on one of the two ladders, and
 * known to the override table — the dialog speaks Brain's words, never
 * upstream's, so a rung Brain has no copy for stays in the inbox. The
 * account ladder is announced only on a Pay-As-You-Go workspace in Account
 * Debt — the platform writes those messages into every owned namespace,
 * subscribed ones included, where nothing is suspended. The workspace
 * ladder always stands: the platform writes it only into the subscribed
 * workspace's own namespace.
 */
function candidateOf(
  item: AppNotification,
  input: BillingEscalationSelectionInput
): Candidate | null {
  if (
    item.source !== "cr" ||
    item.popup !== true ||
    item.severity !== "critical" ||
    !isNotificationUnread(item, input.readIds)
  ) {
    return null;
  }
  const ladder = billingLadderOf(item.crName);
  if (ladder == null || CR_OVERRIDES[item.crName ?? ""] == null) {
    return null;
  }
  if (ladder === "account" && input.accountDebt !== true) {
    return null;
  }
  return { item, ladder };
}

function compareIds(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Newest first; ids break ties so the choice is stable across polls. */
function newestFirst(a: Candidate, b: Candidate): number {
  return (
    b.item.timestamp - a.item.timestamp || compareIds(a.item.id, b.item.id)
  );
}

export function selectBillingEscalation(
  input: BillingEscalationSelectionInput
): BillingEscalationSelection | null {
  const candidates: Candidate[] = [];
  for (const item of input.items) {
    const candidate = candidateOf(item, input);
    if (candidate != null) {
      candidates.push(candidate);
    }
  }
  candidates.sort(newestFirst);
  const [newest] = candidates;
  if (newest == null) {
    return null;
  }
  return {
    announced: newest.item,
    ladder: newest.ladder,
    // Sorted newest first, so every other same-ladder candidate is older or
    // a same-second peer; matching on the id rather than a strict timestamp
    // keeps the tie-break's loser from surviving the dismissal unread.
    superseded: candidates
      .filter(
        (candidate) =>
          candidate.ladder === newest.ladder &&
          candidate.item.id !== newest.item.id
      )
      .map((candidate) => candidate.item),
  };
}

/** The Notifications one dismissal marks read: the announced stage and its superseded set. */
export function billingEscalationDismissalTargets(
  selection: BillingEscalationSelection
): AppNotification[] {
  return [selection.announced, ...selection.superseded];
}

/** One run of body text; the deadline is the only emphasized run. */
export interface BillingEscalationBodySegment {
  emphasis: boolean;
  text: string;
}

export interface BillingEscalationStage {
  body: readonly BillingEscalationBodySegment[];
  /** The fix: the Desktop top-up for the account ladder, renew/upgrade for the workspace ladder. */
  fix: BillingCta;
  ladder: BillingLadder;
  title: string;
}

/** The subscription facts the workspace ladder's copy is refined with. */
export interface BillingEscalationStageContext {
  subscription: Pick<
    WorkspaceSubscriptionSummary,
    "recoveryVoice" | "warningDeadlineAt"
  > | null;
}

function plain(text: string): BillingEscalationBodySegment[] {
  return [{ emphasis: false, text }];
}

/** "on <date>" with the date set off, or the banner's "soon" when none is known. */
function deadlineSegments(
  lead: string,
  deadline: string | null,
  tail: string
): BillingEscalationBodySegment[] {
  if (deadline == null) {
    return plain(`${lead}soon${tail}`);
  }
  return [
    { emphasis: false, text: `${lead}on ` },
    { emphasis: true, text: deadline },
    { emphasis: false, text: tail },
  ];
}

/**
 * The workspace ladder's body, refined from the override table's copy in
 * the dialog only: the suspension and deletion-approaching stages carry the
 * Deletion Countdown's next deadline — the same date the Status Hint
 * states — and speak in the subscription's recovery voice (an unpriced Free
 * plan is never asked to renew). The final stage deliberately names no
 * date: by then the deadline the summary derives (expiry plus the grace
 * period) has already passed, and its message is that resources can go at
 * any time — a date would soften exactly that urgency (AIM-348, story 5;
 * the prototype's final variant; CONTEXT.md names the exception).
 */
function workspaceBody(
  crName: string,
  fallback: string,
  context: BillingEscalationStageContext
): BillingEscalationBodySegment[] {
  const deadline = formatStatusHintDeadline(
    context.subscription?.warningDeadlineAt ?? null
  );
  switch (crName) {
    case "workspace-debt-debt":
      return deadlineSegments(
        "The subscription has expired and this workspace is suspended. Resources will be deleted ",
        deadline,
        context.subscription?.recoveryVoice === "resubscribe"
          ? " unless you upgrade to a paid plan."
          : " unless you renew."
      );
    case "workspace-debt-debtpredeletion":
      return deadlineSegments(
        "The subscription is still unpaid. Resources will be permanently deleted ",
        deadline,
        "."
      );
    default:
      return plain(fallback);
  }
}

/**
 * The words and fix for an announced stage. Title and body come from the
 * merged item — the override table's Brain-voiced copy, never upstream's —
 * with the workspace ladder's refinements above; an Account Debt stage
 * keeps the override body as is and states no date.
 */
export function billingEscalationStage(
  announced: Pick<AppNotification, "body" | "crName" | "cta" | "title">,
  context: BillingEscalationStageContext
): BillingEscalationStage | null {
  const ladder = billingLadderOf(announced.crName);
  if (ladder == null || announced.crName == null) {
    return null;
  }
  const body = announced.body ?? "";
  if (ladder === "account") {
    return {
      body: plain(body),
      fix: announced.cta ?? TOP_UP_BALANCE,
      ladder,
      title: announced.title,
    };
  }
  return {
    body: workspaceBody(announced.crName, body, context),
    fix: paymentDueCta(context.subscription?.recoveryVoice ?? "renew"),
    ladder,
    title: announced.title,
  };
}

/**
 * A stage built from the override table alone, for the dev-tweaks knob that
 * forces the dialog open without any Notification behind it.
 */
export function billingEscalationStageForName(
  crName: string,
  context: BillingEscalationStageContext
): BillingEscalationStage | null {
  const override = CR_OVERRIDES[crName];
  if (override == null) {
    return null;
  }
  return billingEscalationStage(
    { body: override.body, crName, cta: override.cta, title: override.title },
    context
  );
}
