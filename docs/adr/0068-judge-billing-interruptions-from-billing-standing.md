# Judge Billing Interruptions from billing standing, after a deployment fails and before a paid chat turn starts

## Status

Accepted; the pre-deploy seam's posture is revised by ADR-0069 — the Deploy Billing Wall's refusal is softened into the advisory Deploy Billing Notice. The judgment itself, the terminal failure reverse-check, and the Paid Chat Wall stand.

The platform stops a workspace's work when its money or quota runs out, but it tells Brain nothing: Sealos suspends an account in Account Debt by pinning the namespace under a zero `debt-limit0` ResourceQuota and scaling its workloads to zero, and a full deployable quota simply leaves a pod unschedulable. A Deployment Runner sees only a stall (a runtime or readiness timeout, or an `exceeded quota` apply error naming `debt-limit0`), and an AI Proxy turn sees a `403 group_balance_not_enough`. We decided to name these Billing Interruptions by **re-reading the workspace's billing standing** — one account-service read of account, credits, subscription and resource quota, judged into Account Debt / full quota / Paid Source — at three seams that must never disagree: the pre-deploy judgment before a run (then the Deploy Billing Wall, since ADR-0069 the advisory Deploy Billing Notice), the deployment's terminal failure write, and the Paid Chat Wall before a `user` turn.

## Decision

**The terminal failure write reverse-checks billing (extends ADR-0042).** Only a failure whose cause is not already proven at its boundary may be rewritten: cancellation, GitHub authentication, clone, image build, skill install, template output and missing output stay as the runner said. Account Debt on a Pay-As-You-Go workspace rewrites everything else to `balance-exhausted` — including an apply-time `quota-exceeded`, because under suspension the provider's quota error is the debt speaking, and its requested/used/limited numbers would send the user to enlarge a quota that is not the problem. Account Debt is account-level, so a subscribed workspace's account can be in it too — but the platform suspends only PAYG workspaces for it, and a subscribed workspace keeps the runner's reason (or the quota's): a Stripe-paying subscriber whose gift credit has expired sits at exactly zero available and must neither be walled nor told to top up. A full quota rewrites only stall-shaped failures (timeouts, runtime waits, gateway timeouts, unknowns) to a resource-attributed `quota-exceeded`; an apply error the provider explained keeps its text. Each rewrite carries allowlisted Billing Evidence that every runner may persist and show.

**When the reverse-check names a cause the runner never saw, the curated reason replaces the raw error on every runner.** The stall text contradicts the headline ("balance exhausted" over a timeout stack, "quota full" over a readiness timeout), so ADR-0042's raw display is withheld for it — the scrub ⇔ raw-display rule stands, the raw text is dropped rather than shown. An apply-time quota error the provider itself reported keeps the raw text under the quota evidence.

**Paid chat turns are walled server-side before any state mutates (extends ADR-0065).** A `user` turn whose Paid Source is exhausted is refused with HTTP 402 and a `code` of `ai_credits_exhausted` or `account_balance_exhausted`, carrying the Paid Source and wall in the `X-Chat-*` header set; the AI Proxy's own mid-stream billing refusal is classified as `ai_proxy_billing_refused`. Arbitration in the card slot becomes wall > blocked > billing-error > error > counter, preserving ADR-0065's blocked > error > counter. A `user` turn now costs the trial judgment plus the standing reads, run in parallel under the same 5 s budget — where ADR-0065 spoke of one call per turn, there are now several, still uncached and still fail-open.

**Every seam fails open.** A failed, timed-out or unparsable standing read walls nothing, rewrites nothing and refuses nothing; the pre-deploy wall never triggers on a low but positive balance.

## Considered Options

- **Wait for a platform signal.** Rejected: there is none — no webhook, no event, no annotation the runner can read from its request-scoped credentials — and ADR-0065 already ruled out building a local projection without an event channel.
- **Let the provider's apply error outrank Account Debt.** Rejected: `debt-limit0` makes every apply in a suspended namespace fail with `exceeded quota`; showing those numbers as a quota problem is a lie with a wrong CTA.
- **Keep the raw stall text under a billing reason.** Rejected: a headline that contradicts its own detail is exactly what the interruption scenes exist to remove; the misjudgment escape is Redeploy, which stays in the footer once.
- **Cache the standing across turns or runs.** Rejected for the reasons of ADR-0065: no invalidation channel, and the cost is one in-cluster read under a seconds-long turn or a minutes-long deploy.
- **Fail closed on an unreadable standing.** Rejected: billing judgment never gets to stop the console; a missed interruption costs one confusing failure, a false wall blocks paying users.

## Consequences

- The terminal failure write is now also the billing chokepoint: a run launched without a verifiable Workspace Actor cannot reverse-check and keeps its stall classification.
- Two Deployment Failure Reasons and their Billing Evidence are proven by a read of account-service, not by the runner; tests exercise the judgment as a pure function over a standing.
- `/api/chat` grows two 402 codes beside `free_chat_turns_exhausted`; ADR-0065's per-turn cost line now reads "several reads under one budget".
- A subscription under the Deletion Countdown (payment-due) is suspended too, but it is neither Account Debt nor a full quota: its deployment still fails as the stall the runner saw, and the payment-due status hint carries the Renew voice. Walling or naming it needs its own Deployment Failure Reason and a revision of the Deploy Billing Wall — a follow-up taken by ADR-0069, which folds payment-due into the Deploy Billing Notice and commissions its reason.
- Dev fixtures can stage both walls and both interruptions (`failed-balance`, `failed-quota`, `ai-credits-exhausted`, `refused-*`), since the platform's steady-state mocks alone cannot.

## Addendum (2026-08-31): the status hint narrows like the wall, and the debt formula gains the never-billed skip

Two divergences between Brain's re-implemented judgment and the platform's own debt state machine (verified against `labring/sealos` main, commit `31d9e1d`) are closed:

- **The Account Debt status hint now uses the wall's predicate.** The banner used to voice account-level debt in every workspace; on a subscribed workspace at exactly zero available (the expired-gift-credit subscriber this ADR already protects from the wall and the top-up voice) it asserted "Pay-as-you-go workspaces are suspended" — a claim Brain cannot verify and copy that admits it is about somewhere else. The banner and the pre-deploy wall now share one judgment (`accountDebtHolds`): Account Debt holds only on a Pay-As-You-Go workspace. The server-side `standing.accountDebt` deliberately stays account-level — a subscribed workspace's account can be in debt too — and narrows to PAYG only where it acts, in `debtSuspendsWorkspace` and the Paid Chat Wall's Paid Source.
- **Both debt formulas replicate the platform's never-billed guard.** Upstream skips accounts with zero lifetime deductions (`DeductionBalance == 0`), so a fresh zero-balance account — e.g. a new user whose free-plan gift was withheld — stays in good standing and is never suspended. Brain's `available <= 0` check now applies only to accounts that have ever been billed, in the client inputs and the server standing alike; without this, Brain declared a debt the platform never enters.

The zero-inclusive threshold itself is confirmed correct: upstream treats only a strictly positive available amount (`Balance − DeductionBalance + UsableCredits > 0`) as good standing, so exactly zero on an ever-billed account is DebtPeriod and suspension.
