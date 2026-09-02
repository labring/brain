# Wall zero-allowance plans with a truthful cause

ADR-0069 hands exhausted Free Chat Turns to the caller's AI Proxy on the
assumption that a spendable Paid Source is waiting there. Upstream facts
(verified 2026-09-01 against the usw-1 production cluster, `labring/sealos`
and `labring/aiproxy` sources) say otherwise for the plans that matter most.
This decision revises ADR-0069's exhaustion consequence and extends
ADR-0068's Paid Chat Wall with a truthful cause.

## Upstream facts

- **The production Free plan grants no AI Credits.** Its `ai_quota` is 0,
  and account-service skips creating a quota package entirely when
  `ai_quota <= 0` — so an Active Free Trial workspace's `user` turns are refused by
  aiproxy unconditionally, on every turn.
- **A subscribed workspace never spends the Account Balance on AI.** For a
  namespace carrying the `subscription.sealos.io/status` annotation, the
  aiproxy pre-check reads only `remainAIQuota`; account-service's response
  has no balance field on that branch, and the charge endpoint branches
  hard between quota and balance. There is no fallback.
- **aiproxy refuses below a floor, not at zero.** Its
  `GroupMinimumBalance = 0.3` (and a per-request estimated-cost check)
  refuses while a small remainder still shows.
- The former judgment here (`total > 0 && used >= total`) therefore never
  walled the zero-allowance case: the composer stayed open and every send
  died as a generic error instead of a billing refusal.

## Decision

**A zero AI allowance walls, with a truthful cause.** When the standing
read shows AI Credits with `total <= 0`, the Paid Chat Wall's cause is
`allowance-trial` (the Active Free Trial judgment explains the stop:
"Free trial messages used up") or `allowance-plan` (everything else:
"AI usage not included"). An unknown credits read still fails open. The
wall behaves as every Paid Chat Wall does under ADR-0068: the pre-send gate
refuses with `402 ai_allowance_missing`, the card names the cause and the
Upgrade CTA, and the composer locks at once with a placeholder stating why.

**The exhaustion floor mirrors aiproxy.** AI Credits are exhausted below
`AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS = 300_000` (0.3 currency units at the
1e6 precision), not at zero, so the wall and the upstream refusal agree at
the bottom of the allowance. If upstream moves `GroupMinimumBalance`, this
mirror must follow.

**Dev tooling covers every posture.** The chat billing-card tweak fabricates
the allowance wall in both voices; the billing Dev Mock answers
`/api/chat/free-turns` from a fixture so the sidebar's usage row and the
Plan view's allowance card follow the scenario.

## Considered Options

- **Keep the silent handoff as shipped.** Rejected: on the production Free
  plan the sixth turn is a guaranteed refusal loop told as generic errors.
- **Restore the pre-ADR-0069 blocked mode with its single copy.** Rejected:
  "free trial used up" is untrue for workspaces that never had a trial. The
  lock is kept; the cause is forked.
- **Soften the wall into an advisory notice** (ADR-0070's deploy pattern:
  composer open until a send is actually refused, the refusal arming the
  lock). Rejected: a wall that already knows the next send is refused has
  nothing to wait for, and a refusal-armed lock splits the locking state
  between the pane and its per-thread session.
- **Fall back to the Account Balance when credits run out.** Rejected:
  upstream has no such path for a subscribed workspace; pretending
  otherwise would mis-narrate every refusal.

## Consequences

- An Active Free Trial workspace meets the locked allowance wall the moment
  its last Free Chat Turn is spent, in the Free trial messages voice; a
  subscription that never had a trial meets it in the plan voice.
- ADR-0069's "the sixth turn can consume the caller's AI Credits or Account
  Balance" holds only where the plan actually grants AI Credits; on the
  production Free plan the sixth turn meets the allowance wall instead.
- The 0.3 floor is a deliberate copy of an upstream constant and can drift;
  it lives in one exported constant beside the wall judgment.
- A refusal that bypasses the gate (a credits read that failed open, then
  aiproxy refusing the turn) is still voiced as a Billing Interruption from
  the Paid Source the pane knows — AI Credits, for a zero-allowance
  subscription. Narrowing that voice to the allowance cause is a follow-up.
- CONTEXT.md's Paid Chat Wall and Free Chat Turns entries are updated for
  the allowance causes.
