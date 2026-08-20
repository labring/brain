# Call account-service with Self-Signed Internal JWTs

The billing migration gives Brain 21 API routes whose upstream is the
platform's account-service. account-service authenticates billing calls with
a single mechanism: an HS256 JWT signed with the cluster-shared `jwtInternal`
key, requiring only a `userId` or `userUid` claim. There is no
kubeconfig-accepting billing endpoint, no credential-translation gateway, and
no HTTP endpoint resolving a crName to a userUid — the AI-Proxy-style
"forward the kubeconfig" pattern is structurally unavailable for billing.
Brain already holds the same key as `JWT_INTERNAL` for verifying
desktop-minted app tokens (ADR-0059), and desktop delivers a verified
`userUid` binding with every personal-resource request.

## Decision

### Billing routes are personal-resource routes

All migrated billing routes reuse the existing inbound contract with zero
additions: the client fetcher sends the kubeconfig plus `X-Sealos-App-Token`;
the server authorizes the Workspace Actor and runs the ADR-0059 hard checks
to obtain a verified `userUid`. The `userId` used outbound comes from the
same verified token payload — `verifyAppTokenBinding` returns it alongside
`userUid` at the same trust level. Client-supplied uids are never trusted.

Missing token, signature failure, actor mismatch, or region mismatch → 401
with **no crName fallback**: billing data is uid-keyed at the source, so no
degraded crName path can answer. An expired but validly signed inbound token
is accepted per ADR-0059 — the outbound token is freshly signed, so inbound
expiry never propagates to the upstream call. Billing routes only read
account-service and perform subscription operations; they never touch Brain's
own database, so they have no interaction with lazy re-key or Identity
Fingerprints.

### Sign a fresh token per outbound call

The shared account-service client signs a fresh HS256 JWT for every outbound
call: claims exactly `{userUid, userId}` — camelCase, matching what
account-service already accepts from costcenter — TTL 5 minutes, no caching
(costcenter's 5-day token is not copied). The claims never include
`userCrName`, `regionUid`, or `requester`: the last reaches account-service
admin paths and must never appear in a Brain-minted token.

The signing helper follows the `lib/devbox/config-core.ts` pattern: injected
configuration, an `isConfigured` gate, fail-closed behavior, and no default
secrets — the source's `|| '123456789'`-style fallback is forbidden.

### One base URL env, chart-derived in cluster

`ACCOUNT_API_BASE_URL` is a required production setting sharing the
fail-closed gate with `JWT_INTERNAL`. The helm chart leaves it empty and
derives the in-cluster constant
`http://account-service.account-system.svc:2333` — byte-identical to
costcenter's production values, bypassing the ingress. Local development
(off-cluster) sets the `account-api.<domain>` ingress explicitly; the ingress
is a pure pass-through, not a credential translator.

### Reuse `JWT_INTERNAL` for signing

costcenter holds the cluster key twice under two names — `auth.jwt.internal`
for inbound verification and `components.billing.secret` for outbound
signing. They are the same ConfigMap value, and Brain folds both uses into
the one `JWT_INTERNAL` it already requires: signing and verification share
one configuration object, no second copy. The single-key blast radius — a
`jwtInternal` leak can mint arbitrary identities platform-wide, including
admin-path requesters — is not enlarged by this decision; it already holds
for the verification use ADR-0059 accepted.

## Considered Options

- Forward the desktop-minted app token as the outbound bearer (same key,
  compatible claims — account-service would verify it): rejected. Its only
  advantage, zero new secret handling, evaporated once ADR-0059 made Brain
  hold `JWT_INTERNAL` anyway. Worse, it contradicts Brain's own identity
  model: Brain deliberately accepts expired app tokens (mapping-certificate
  semantics), while account-service enforces `exp` on a token desktop never
  refreshes — billing would hard-fail on exactly the long sessions Brain
  chose to tolerate, with re-login as the user's only remedy.
- Forward the kubeconfig through a translation gateway (the AI Proxy
  pattern): unavailable. No billing endpoint accepts a kubeconfig; the
  kubeconfig-auth code path in account-service is dead code.
- Resolve crName → userUid from the region database and then self-sign:
  rejected. Couples Brain to a private schema for a mapping the verified app
  token already proves.
- Derive the base URL from the kubeconfig hostname: rejected. ADR-0052
  governs Kubernetes API transport; upstream service addresses follow the
  explicit-env-plus-chart-derivation precedent (`DEVBOX_API_BASE_URL`).
- Cache the outbound token (costcenter signs for 5 days): rejected. Signing
  is cheap, a 5-minute single-use token minimizes replay value, and caching
  adds invalidation state for no measurable gain.

## Consequences

Deployments gain one required setting, `ACCOUNT_API_BASE_URL`, chart-derived
in cluster and fail-fast in production. `JWT_INTERNAL` gains a signing use
with no new copies or storage.

Every billing request is attributable to a verified `userUid` end to end;
no billing route works without a valid app-token binding, so there is no
anonymous or crName-keyed billing access to reason about.

Brain-minted tokens are confined to `{userUid, userId}`: compromise of a
single outbound token exposes five minutes of one user's billing scope,
never an admin path. The pre-existing platform-wide `jwtInternal` blast
radius stands unchanged.

ADR-0052's scope is clarified by precedent, not revised: kubeconfig transport
rules govern Kubernetes API access, while upstream service addresses use
explicit configuration.
