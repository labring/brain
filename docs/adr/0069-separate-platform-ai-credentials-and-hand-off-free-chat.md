# Separate platform AI credentials and hand off exhausted Free Chat Turns

## Status

Exhaustion consequence revised by ADR-0073: the handoff stands, but a plan
that grants no AI allowance (the production Free plan's `ai_quota` is 0)
meets the Paid Chat Wall's allowance cause instead of a spendable Paid
Source.

Chat Agent and GitHub Deployment Tasks are different workloads with different
platform funding. Their environment variables must select only their own
platform connection, then fall back directly to the caller's AI Proxy. This
decision revises ADR-0065's exhaustion behavior and extends ADR-0068's paid
chat gate.

## Decision

**Free Chat eligibility and accounting stay unchanged.** Only an Active Free
Trial workspace may spend Free Chat Turns. `FREE_CHAT_TURNS` defaults to 5, and
each successful `free` turn uses `SYSTEM_OPENAI_API_KEY` with
`SYSTEM_OPENAI_API_BASE_URL`. Failed turns return their reservation. Paid
plans, PAYG, PAUSED Free, expired trials, and workspaces without a complete
system connection use `user` billing from their first turn.

**Exhaustion hands off to the caller's AI Proxy.** After an eligible workspace
spends its last Free Chat Turn, Chat Billing Mode becomes `user`. The next turn
uses the caller's AI Proxy and is gated by ADR-0068's Paid Chat Wall before any
conversation state changes. The former `blocked` mode,
`free_chat_turns_exhausted` response, locked composer, and upgrade card are
removed. A platform-funded turn that fails does not retry against the user's
AI Proxy in the same request; silent provider failover would unexpectedly bill
the user.

**GitHub Deployment Tasks have one optional platform connection.** A complete
`GITHUB_DEPLOY_OPENAI_API_KEY` and `GITHUB_DEPLOY_OPENAI_BASE_URL` pair funds
GitHub-source AI Runner work. When both values are blank, the runner obtains an
AI Proxy Token for the Workspace Actor bound to the Deployment Task and injects
that user connection into the Deploy Devbox. Setting only one value is a
configuration error. An invalid or unavailable configured platform connection
fails the task; it does not retry with user billing.

**Platform credentials never cross workload boundaries.** GitHub Deployment
Tasks do not fall back to host `CODEX_GATEWAY_OPENAI_*` values or
`SYSTEM_OPENAI_*`. `CODEX_GATEWAY_OPENAI_API_KEY` and
`CODEX_GATEWAY_OPENAI_BASE_URL` remain internal variable names injected into a
Deploy Devbox after Brain has selected either the GitHub platform connection or
the caller's AI Proxy. Prompt-source AI Runner work always uses the caller's AI
Proxy.

**Model selection stays independent.** `ASSISTANT_GATEWAY_MODEL` selects the
Chat Agent model. `GITHUB_DEPLOY_MODEL` selects the model used by Codex inside
a GitHub Deployment Task's Deploy Devbox. Neither model variable selects or
implies credentials. `CODEX_GATEWAY_MODEL` remains an internal Deploy Devbox
variable and is not a Brain configuration input.

## Considered Options

- **Keep blocking an Active Free Trial after five turns.** Rejected: the
  product now intentionally continues through the caller's metered AI Proxy,
  subject to the Paid Chat Wall.
- **Let GitHub Deployment Tasks reuse Chat Agent or host Codex credentials.**
  Rejected: it hides which platform budget funds a task and makes an unrelated
  Chat configuration change deployment billing.
- **Silently accept a partial GitHub platform pair.** Rejected: falling back in
  that state can charge a user because of an operator typo.

## Consequences

- The sixth Chat Agent turn in an eligible Active Free Trial workspace spends
  the caller's AI Credits where the plan grants any (a subscribed workspace
  never spends the Account Balance on AI — ADR-0073). The Paid Chat Wall
  remains the server-authoritative refusal when nothing is spendable.
- Operators can disable platform-funded GitHub Deployment Tasks by leaving the
  dedicated pair blank without affecting platform-funded Chat turns.
- No database migration is required. Existing Deploy Devboxes retain the
  credentials selected when they were created; new tasks use the current
  environment configuration.
