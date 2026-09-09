import type { WorkspaceOwnerStanding } from "./workspace-owner";

/**
 * The platform's money-side Account Debt predicate (CONTEXT.md, Account
 * Debt): only a strictly positive available amount is good standing, and
 * the state machine skips never-billed accounts — with zero lifetime
 * deductions a fresh zero-balance account is never in debt. The status
 * hint, the server-side billing standing, and the Plan page's balance
 * display all call this one judgment so it can never drift between them.
 * Money facts only — whether debt suspends THIS workspace stays a PAYG
 * question its callers answer.
 */
export function accountDebtFromMoney(input: {
  availableBalanceMicroUnits: number;
  lifetimeDeductionMicroUnits: number;
}): boolean {
  return (
    input.lifetimeDeductionMicroUnits > 0 &&
    input.availableBalanceMicroUnits <= 0
  );
}

/**
 * Whether Account Debt suspends THIS workspace — the one predicate behind
 * the Deploy Billing Notice, the Status Hint banner, and the server-side
 * standing (ADR-0070 merged the client and server variants). The platform's
 * debt pipeline stops only Pay-As-You-Go workspaces; whether the account is
 * in debt at all is a money fact (`accountDebtFromMoney`) or the platform's
 * own DEBT report, judged by the caller. Null while either fact is unknown:
 * every seam fails open (ADR-0068).
 */
export function accountDebtSuspends(input: {
  /** Whether the account is in Account Debt; null while unknown. */
  accountDebt: boolean | null;
  /** Whether this workspace is Pay-As-You-Go; null while unknown. */
  isPayg: boolean | null;
}): boolean | null {
  if (input.isPayg == null) {
    return null;
  }
  if (!input.isPayg) {
    return false;
  }
  return input.accountDebt;
}

/**
 * Account Debt as the Workspace Owner's fact (ADR-0082). The platform's own
 * suspension mark on the namespace is debt for every Workspace Actor; the
 * caller's own balance (`money`, from `accountDebtFromMoney`) speaks only
 * when the caller is proven to be the Owner — a member's Account Balance is a
 * different account's fact. A readable namespace with no mark clears the
 * debt for a non-owner; an unknown owner with no mark stays unknown, never
 * assumed. Shared by the client inputs and the server-side standing so the
 * banner, the walls, and the failure reason can never name different
 * accounts.
 */
export function accountDebtByOwner(input: {
  /** The caller's own available-balance judgment; null while unread. */
  money: boolean | null;
  owner: WorkspaceOwnerStanding;
}): boolean | null {
  if (input.owner.platformDebt === true) {
    return true;
  }
  if (input.owner.isOwner === true) {
    return input.money;
  }
  // A proven non-owner with no mark stands clear; an unknown owner might be
  // the Owner whose early warning nobody read, so the fact stays unknown.
  return input.owner.isOwner === false && input.owner.platformDebt === false
    ? false
    : null;
}

/**
 * What a Workspace Actor who is not the Owner is told when the Owner's
 * account is in debt (ADR-0082): the truth and no dead end — no amount, no
 * owner name (Brain holds only a CR name), and no Top up CTA, since only
 * the Owner can top up. Every seam speaks this same line.
 */
export const MEMBER_ACCOUNT_DEBT_VOICE = {
  ask: "Ask the workspace owner to top up.",
  description:
    "The owner's account balance is in debt. Ask the workspace owner to top up.",
  title: "Workspace suspended — owner's balance in debt",
} as const;
