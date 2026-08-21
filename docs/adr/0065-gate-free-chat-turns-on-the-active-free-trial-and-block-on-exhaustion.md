# Gate Free Chat Turns on the Active Free Trial and block on exhaustion

Free Chat Turns become a benefit of the Active Free Trial instead of an unconditional per-namespace grant, and exhausting them during the trial now **blocks** assistant requests instead of silently switching to `user` billing. This replaces the deleted ADR-0033 (free-allowance counter plus one-time crossing toast): the automatic `free`→`user` handoff and the crossing toast are gone.

## Decision

**Eligibility is the upstream trial definition.** A workspace may spend Free Chat Turns only while its subscription is a Free plan in normal standing (`type SUBSCRIPTION`, plan name `free`, status `NORMAL`, all trimmed case-insensitive) — upstream's own trial semantics: a PAUSED Free subscription is a born-suspended no-trial state (second and later workspaces; granting it would open a per-workspace refill loophole against a per-user lifetime trial), and an expired trial joins the same DEBT pipeline as any paid plan, where Billing Area messaging takes over. Every other state — paid plans, PAYG, DELETED, unknown future statuses — bills `user` from its first turn.

**Judged live, per turn, fail-open.** `/api/chat` queries account-service subscription/info on every turn (session bootstrap too) with a 5s timeout and no cross-turn cache: upstream has no webhook or event channel, so a local projection is unbuildable and a TTL cache only buys invalidation bugs; the call is one HS256-signed in-cluster POST under a seconds-long LLM turn. The region is the deployment-declared `BILLING_LOCAL_REGION_DOMAIN` (ADR-0064). **A failed, timed-out, or unparsable judgment never blocks**: with local count remaining the turn is served free (still consumed — the lifetime cap bounds platform exposure), with the count exhausted it degrades to `user`. Blocking happens only on a confirmed Active Free Trial.

**Blocking is server-authoritative, in two layers.** Panel-side refusal (composer message-path lock at zero remaining) is UX only. The `/api/chat` entry hard-refuses confirmed-blocked requests with **HTTP 402** and body `{ code: "free_chat_turns_exhausted", error }`, carrying the full `X-Chat-*` header set. Clients identify blocking by the headers in the existing transport fetch wrapper — the AI SDK discards status codes, and that wrapper is the one place that still sees them; the body `code` is the refusal's formal identity for tests and non-browser callers. All `/api/chat` error responses converge on the `{ code, error }` envelope.

**The billing signal grows a third state.** `billing` is `free | user | blocked`, computed server-side only (bootstrap and headers agree; clients render, never derive). `blocked` requires: Active Free Trial ∧ platform model configured ∧ limit > 0 ∧ remaining 0 — so `FREE_CHAT_TURNS=0` (feature disabled) and missing-platform-model deployments keep their silent `user` behavior. The last free turn already reports `blocked`, flipping the panel the moment it finishes. When card states collide, arbitration is blocked > error > counter. Leaving `blocked` relies solely on remount bootstrap — `/billing` is a full-page navigation, so returning re-fetches the session; no focus refetch, no polling.

**What ADR-0033 got right survives.** Steady-state `user` billing shows no paid indicator — paying is the ambient baseline on a metered platform — and a deployment with no platform model stays silently `user` from the first turn (its untouched turns unspendable, and never `blocked`).

**The counting model is untouched; the spend timing is reserve-then-rollback.** The namespace-shared lifetime counter stands as decided in ADR-0047/0056/0059 (`assistant_entitlements`, namespace key, monotonic, no reset — upstream trials are once per user for life, so no return-and-reset scenario exists), and `FREE_CHAT_TURNS` stays a global env (default 5, `0` disables). The trial gate lives in the judgment layer, never in the table. A `free` turn atomically reserves its count **before** model execution — the pre-flight snapshot is advisory, so concurrent turns race on the counter itself and can never overspend the cap; the loser re-judges on a fresh snapshot (402 on a confirmed trial, `user` otherwise). Every unsuccessful path (preflight failure, stream error, abort, lost lease) returns the reservation, so a failed turn still costs nothing. A crash between reservation and rollback leaks one turn — bounded, and it errs toward the platform, never toward overspending.

## Considered Options

- **Keep granting all workspaces (status quo).** Rejected: the allowance's purpose is trial conversion; unconditional grants fund users who already pay and leave no upgrade story.
- **Keep the automatic `free`→`user` switch on exhaustion.** Rejected: it silently converts a free trial into metered spending — the decision to start paying belongs to the user, made through an explicit upgrade.
- **A grace path after exhaustion (backdoor continued free use).** Rejected: it recreates the unconditional grant behind the block and makes the counter a lie.
- **TTL cache or local subscription projection.** Rejected for now: no upstream event channel exists (notifications are email/SMS only). If upstream grows one, the evolution is a local projection, not a cache.
- **Fail-closed on judgment failure.** Rejected: the console never yields to billing judgment; misjudgment cost is bounded by the lifetime cap.
- **429 or 403 for the refusal.** Rejected: 402 is the semantic fit and stays distinct from auth (401/403) and rate limiting (429).

## Consequences

- The blocking card and its upgrade CTA can only appear inside a live trial: the workspace is alive and the upgrade flow is guaranteed walkable. Expired-trial messaging belongs to the Billing Area, not the chat panel.
- The Billing Area Plan view renders its free-allowance block under exactly the same predicate — trial only, no PAUSED/DEBT rendering.
- The crossing toast and its two client code paths are deleted outright.
- Per-turn judgment adds one in-cluster call per turn and accepts stale-free-turn edge cases within a single in-flight turn (a turn runs to completion under the judgment it started with).
- The last free turn's `blocked` header is a fact at send time (the turn is already reserved), but a failed stream rolls the reservation back after the header shipped; the chat client refetches the session on stream error as well as on finish, so a rolled-back turn unlocks the composer again.
