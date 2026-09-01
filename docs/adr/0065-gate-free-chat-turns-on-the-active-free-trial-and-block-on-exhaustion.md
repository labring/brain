# Gate Free Chat Turns on the Active Free Trial

## Status

Revised by ADR-0069, which replaces the exhaustion block with a handoff to
`user` billing. This record remains authoritative for trial eligibility,
per-turn judgment, and free-turn accounting.

Free Chat Turns are a benefit of the Active Free Trial instead of an
unconditional per-namespace grant. This replaces the deleted ADR-0033's
unconditional allowance; ADR-0069 owns what happens after the allowance is
exhausted.

## Decision

**Eligibility is the upstream trial definition.** A workspace may spend Free
Chat Turns only while its subscription is a Free plan in normal standing
(`type SUBSCRIPTION`, plan name `free`, status `NORMAL`, all trimmed
case-insensitive) — upstream's own trial semantics. A PAUSED Free subscription
is a born-suspended no-trial state, and an expired trial joins the same DEBT
pipeline as any paid plan. Every other state — paid plans, PAYG, DELETED, and
unknown future statuses — uses `user` billing from its first turn.

**Judged live, per turn, fail-open.** `/api/chat` queries account-service
subscription/info on every turn and session bootstrap with a 5s timeout and no
cross-turn cache. A failed, timed-out, or unparsable judgment never blocks the
console: with local count remaining the turn is served free and consumed; with
the count exhausted it uses `user` billing.

**The billing signal is server-authoritative.** `billing` is `free | user`,
computed server-side only; bootstrap and response headers agree, and clients
render rather than derive it. `free` requires an Active Free Trial (or an
unknown fail-open judgment), a configured platform model connection, and a
remaining allowance. `FREE_CHAT_TURNS=0`, a missing platform connection, and
every ineligible subscription state use `user` billing without spending the
allowance.

**The counting model is reserve-then-rollback.** The namespace-shared lifetime
counter remains as decided in ADR-0047/0056/0059 (`assistant_entitlements`,
namespace key, monotonic, no reset). `FREE_CHAT_TURNS` stays a global env with a
default of 5; `0` disables it. A `free` turn atomically reserves its count
before model execution, so concurrent turns cannot overspend the cap. Every
unsuccessful path returns the reservation. A crash between reservation and
rollback can leak one turn, bounded toward the platform rather than
overspending.

## Consequences

- The allowance can only be spent by an Active Free Trial workspace; paid
  plans, PAYG, PAUSED Free, and expired trials use the caller's AI Proxy from
  their first turn.
- The Billing Area Plan view renders the free-allowance block under the same
  Active Free Trial predicate.
- Per-turn judgment adds account-service reads without a cache because there
  is no invalidation channel.
- ADR-0069 defines the `free` to `user` handoff and the separation between Chat
  Agent and GitHub Deployment Task platform credentials.
