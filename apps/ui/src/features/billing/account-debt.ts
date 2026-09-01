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
 * standing (ADR-0069 merged the client and server variants). The platform's
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
