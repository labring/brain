# Name the Paused Workspace Subscription as its own Billing Interruption

The platform creates a user's second and later workspaces (and, in a region without free trials, every workspace) with a Free Workspace Subscription already in `PAUSED` status: zero quota from birth, and its billing admission webhook denies every apply with the same "subscription … is expired" text it uses for a lapsed plan. Brain's billing standing recognized only the `DEBT*` ladder as a suspension, so a paused workspace showed no Deploy Billing Notice, its failure reverse-check found nothing, and after ADR-0072 the webhook's wording alone named it `subscription-expired` — a plan-neutral card telling a user who never had a plan that theirs expired. We decided to model the state as its own concept, the **Paused Workspace Subscription**, with its own Deployment Failure Reason (`subscription-paused`), Billing Evidence kind, notice kind, and Status Hint state, voiced everywhere as "no active plan" with a "Choose a plan" CTA to the plan picker.

## Decision

**It is a suspension, not an expiry.** The standing judgment carries a separate `subscriptionPaused` fact beside `paymentDue`; the sidebar summary carries `isPaused` beside its lifecycle. Nothing expired and no Deletion Countdown runs, so no surface borrows the payment-due words, dates, or renewal voice — the recovery is subscribing to a first paid plan. The Billing Area's lifecycle for the same record stays "active", because the plan picker is exactly its way out.

**Severity sits right below payment-due.** Notice, Status Hint, and reverse-check all rank it above Account Debt and a full quota: the platform pins a paused workspace under a zero quota, so a "quota full" or an apply-time quota error there is the suspension speaking. A paused subscription is by construction never on the `DEBT*` ladder, but the order is fixed so the three seams can never disagree (ADR-0070).

**The webhook's "expired" is refined, never trusted alone.** The apply-boundary classifier (ADR-0072) cannot tell paused from expired — upstream's "expired" means any non-`NORMAL` status — so it still yields `subscription-expired`. When the reverse-check can run and the standing says paused, it rewrites the reason to `subscription-paused` while keeping the platform's own denial text raw (`supersedesRunnerError: false`), the same courtesy the provider's quota error and the webhook's expiry denial receive. When it cannot run, the plan-neutral expired card stands as the closest truthful fallback.

**The Status Hint is destructive and not dismissible.** The banner names a workspace that can run nothing — no deployment, no Free Chat Turn — until it has a plan, which is the bar the other suspension states meet; the sidebar's account row says "No active plan · service limited" in the same tone.

## Considered Options

- **Fold `PAUSED` into payment-due with the "resubscribe" recovery voice.** Rejected: every payment-due surface speaks of expiry and the Deletion Countdown's dates, and the Billing Area reads the same record as an active Free plan — the banner and the plan page would contradict each other on a workspace whose plan never ran.
- **Keep `subscription-expired` and let a third recovery voice change the card copy.** Rejected: the persisted reason is the aggregatable classification and the Deployment Task Dock's chip phrase; "subscription expired" on a workspace that never subscribed is the exact untruth ADR-0073 forbids for chat.
- **Fix the deploy seams only and leave the Status Hint alone.** Rejected: ADR-0070 makes the notice mirror the banner's severity so the two can never voice different states; a notice kind without its banner state breaks that invariant on the first paused workspace.
- **Notice and card only, no new reason, wait for the platform to send a distinct status.** Rejected: the platform's own admission message is the ambiguity; the standing read is the only place the distinction exists today.

## Consequences

- CONTEXT.md gains the Paused Workspace Subscription entry; Workspace Subscription, Active Free Trial, Deploy Billing Notice, Billing Interruption, Deployment Failure Reason, Billing Evidence, and Status Hint cross-reference it.
- `subscription-paused` joins the billing-proven reasons: it earns a dock chip phrase ("no active plan"), a plan-neutral technical detail, and supersedes a stall's raw text like the other suspensions.
- ADR-0072's residual gap is closed; its consequence bullet is amended in place rather than left to mislead.
- A paused workspace's chat already bills `user` and meets the `ai_allowance_missing` wall (ADR-0073); this record adds no chat surface — the wall's cause is the plan, which is also the fix.
- The dev tweak's forced notice forms gain `paused`; the `paused` billing dev scenario now lands on the `subscription-paused` banner state instead of none.
