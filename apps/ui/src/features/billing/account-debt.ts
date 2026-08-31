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
