# Key Personal Resources by the Global User UID

Personal resources (Assistant Conversations, GitHub Connections) have been
owned by `(namespace, crName)` since ADR-0056. `crName` is a per-region
identity: the same human holds a different `crName` in every region, so
crName-keyed ownership cannot follow a user across regions and cannot be
attributed to a platform account. The platform's global user identity is
`userUid`. During closed beta the switch cost is near zero and only grows, so
the ownership key moves now.

## Decision

### Key ownership by the global userUid

An Assistant Conversation is owned by `(namespace, userUid)`. A GitHub
Connection is owned by `(namespace, userUid, owner identity generation)`, with
the generation bumped to 2. `crName` never enters uid-keyed resource rows: it
is a per-region identifier and would corrupt a globally keyed model.

### Trust the desktop-minted app token as the uid source

The kubeconfig authenticates `crName` but the cluster cannot resolve a
`userUid` from it — the User CR's `uid` label is the CR uid, not the account
uid, and the authoritative mapping lives only in the region database. Instead
of reading that database, Brain trusts the app token that desktop already
mints and delivers to embedded apps: an HS256 JWT signed with the
cluster-shared `jwtInternal`, carrying `userUid`, `userCrName`, and
`regionUid` (only the first two are read).

Clients send the bare token in a new `X-Sealos-App-Token` header, attached
only by personal-resource fetchers. Servers consult it only at the
personal-resource authorization points and enforce three hard checks:

1. Signature verifies against `jwtInternal`. A missing key fails production
   startup; a default-secret fallback is forbidden.
2. `userCrName` equals the crName authenticated from the request kubeconfig.
3. The existing `user-system` ServiceAccount subject check stays.

Workspace claims in the token are never checked: namespace authorization
remains the kubeconfig's SSAR path. The token proves who is acting, not where
they may act.

Expiry is not checked. In Brain's two-credential model the app token is a
mapping certificate — proof that desktop officially bound this crName to this
userUid — while the kubeconfig is the liveness credential verified on every
request. A stolen token is useless without the victim's currently valid
kubeconfig, so `exp` adds no marginal security; enforcing it would instead
permanently 401 personal resources after seven days, because desktop mints the
token only at login, region switch, and workspace switch and never refreshes
it. Expired-token acceptance is logged to telemetry. Four load-bearing premises
are recorded: `crName` is never recycled, `crName` values never coincide
across regions, desktop always mints `iat` into the token (jsonwebtoken
embeds it whenever `expiresIn` is set) — a platform change to any of these
forces re-review of this ADR — and stale post-merge bindings are caught by
Identity Fingerprints below.

The degradation matrix: all checks pass, expired or not → uid path; signature
failure → 401 with security log; crName mismatch → 403 with security
log; token missing → 401, fail closed; `iat` missing → 401 with security log
(minting-time monotonicity orders merge decisions below, so an unorderable
binding is unverifiable — only a non-desktop minter produces one); binding
superseded per Identity Fingerprint → 401 with telemetry; non-personal routes
never consult the token.

### Reverse ADR-0056's symmetric-secret rejection

ADR-0056 rejected verifying desktop-signed JWTs because Brain would hold a
secret able to mint any user's identity in the region. That rejection is
reversed on new evidence: the platform already runs on the shared
`jwtInternal` — costcenter, aiproxy, objectstorage, and account-service all
hold it, and billing attribution trusts it alone — so Brain joining creates no
new risk category. The residual risk stands: a `jwtInternal` compromise mints
arbitrary identity bindings platform-wide. Brain does not copy the platform's
weakness of accepting a lone credential: it cross-checks the token against
the kubeconfig identity (costcenter accepts either credential alone). Like
the platform's `verifyAppToken`, Brain accepts cross-region token replays —
the token is not pinned to a region. Cross-region replay is blocked one layer
down instead: the kubeconfig liveness credential authenticates only against
its own region's API server (Pods pin the internal API transport), so a
replayed token additionally needs a target-region kubeconfig whose crName
equals the token's — impossible while `crName` values never coincide across
regions, the premise recorded above.

### Migrate existing rows by lazy re-key

Beta data is not wiped. A personal-resource entry request that passes the
token checks issues an idempotent UPDATE re-keying rows from `(namespace,
crName)` to the proven uid. The nanoid crName and UUID userUid formats are
disjoint, so no version column is needed: uid reads make legacy rows invisible
rather than wrong, and the re-key matches only legacy rows. GitHub Connection
re-keys also upgrade the row to identity generation 2; a unique-index conflict
means the user already reauthorized under the uid, and the new authorization
wins. OAuth state rows expire naturally and are not re-keyed. Unlike
ADR-0056's forward-only wipe, this migration needs no maintenance window.
Removing never-claimed legacy rows and the re-key path is deferred
implementation for the end of beta.

### Detect account merges with Identity Fingerprints

An account merge tombstones the swallowed uid — never deleted, never minted
again — and may re-point the region's `crName` to the surviving uid. No event
is emitted anywhere Brain can listen, so uid-keyed rows would orphan silently.
The only in-band signal is a verified request whose `(crName, userUid)`
contradicts what Brain has previously observed.

From day one — the same release that switches the key — the authorization
layer keeps a region-local fingerprint table: `crName` → most recently
observed uid and that token's minting time. A contradiction carrying a newer
minting time is a merge signal: the same transaction re-keys all personal
resources from the tombstone uid to the surviving uid and updates the
fingerprint. The re-key is idempotent and complete, because the tombstone uid
can never be minted again.

Where the surviving uid already holds a current-generation GitHub Connection
in a namespace, the tombstone's connection row there is deleted, not kept
inert: the partial unique index allows one current connection per (namespace,
owner), so the row cannot follow the survivor; and unlike the generation
upgrade's inert legacy rows — which wait for adoption by a verified owner — a
tombstone-keyed row can never have a reader again, leaving only permanently
dead OAuth ciphertext. Removing it is credential hygiene, not data loss: the
conflict exists only when the survivor has already reauthorized, so the
user's active connection is untouched. The trade-off is recorded: this delete
is the merge transaction's only irreversible step, and a falsely detected
merge — possible only where the trust root itself has failed — would destroy
the row beyond manual repair. A contradiction carrying an older minting time is a
superseded token — replayed from before the merge — and is refused with 401;
the desktop re-login loop re-mints a current token. Day-one shipping is load
bearing: fingerprints exist only from the table's creation onward, so merges
occurring before it would be permanently unrecoverable. Deferring the table is
equivalent to abandoning it.

The fingerprint decision and the resource write are separate transactions, so
the authorization-time observation alone cannot stop a request that verified
before a merge from committing tombstone-keyed rows after the re-key sweep.
Two mechanisms close that window. Every transaction that creates or adopts
uid-keyed rows — new conversations, both lazy adoptions, pending GitHub
authorization sessions — re-checks the fingerprint in-transaction under a
share lock on the crName row, serializing it against the merge transaction's
exclusive lock: the guarded write either commits first, and the sweep re-keys
it, or fails closed with the superseded 401. And the merge transaction
re-keys pending current-generation authorization sessions before connections:
the OAuth callback consumes its session row under a row lock and writes the
connection in that same transaction with no crName left to re-check, so the
sweep order guarantees the callback either re-reads the survivor uid from its
re-keyed session or commits a connection row the sweep still catches.

Trusted lifecycle producers carry a verified uid as their sole identity key,
while the fingerprint row requires a crName. A durable uid canonicalization
table maps each ingest or merge uid to its current survivor. Event ingest locks
that row through commit; the merge transaction redirects the tombstone and all
earlier aliases before sweeping personal resources. The ordering guarantees
that a delayed event either commits first and is swept, or reads the survivor
and commits directly under the canonical uid.

### Keep one code path everywhere

Local development mints a real token: a dev `JWT_INTERNAL` in `.env.local`,
and a script that signs a JWT for the dev kubeconfig's crName. The verifier has zero development branches — credentials may be fake,
code paths may not fork. Guest mode is not supported: the platform ships guest
disabled, Brain carries no guest branches, and missing credentials take the
generic fail-closed path.

## Considered Options

- Pin the token to the region (check its `regionUid` claim against a
  configured `REGION_UID`): rejected. The kubeconfig already region-scopes
  every request, so the pin's only value is insurance on the cross-region
  crName premise; it costs a required deployment setting in every region and
  a dev-minting input. The premise is recorded as load-bearing instead of
  enforced in code.
- Resolve crName → userUid from the region database: rejected. It adds a
  standing infrastructure dependency and credentials for a mapping the app
  token already proves with what desktop delivers today.
- Enforce token expiry: rejected. The token is never refreshed, so enforcement
  locks users out of personal resources with no self-remedy, while the
  kubeconfig cross-check already removes the security value of `exp`.
- Wipe beta data (the ADR-0056 precedent) or run a one-shot mapping script:
  rejected. Lazy re-key costs one small function, loses nothing, and needs no
  maintenance window; the script also conflicts with the no-region-DB premise.
- Dual-write crName on every resource row: rejected. A per-region identifier
  must not enter globally keyed rows, and the expired-token fallback argument
  collapsed — the platform's uniform behavior is a hard 401 into desktop's
  re-login loop.
- Accept merge data loss instead of Identity Fingerprints: rejected. Merges
  are low-frequency but the loss is irreversible, and a fingerprint table
  added later cannot recover earlier merges — the choice was day one or never.

## Consequences

Personal-resource ownership survives kubeconfig rotation (as before), and now
also region moves and account merges; support attribution can run on the
global uid. Free Chat Turns remain a namespace-shared allowance.

Identifiers may be recorded; credentials and content may not. `userUid` and
`crName` are permitted in logs, telemetry, audit records, and API responses.
ADR-0056's prohibition list is unchanged and extends to the app token:
kubeconfig bearer tokens, app tokens, OAuth tokens, connection ciphertext, and
conversation content never appear in any of those channels.

Personal APIs keep failing closed, and ADR-0056's distinct error conditions
are preserved. After re-key, rows carry only the uid key: no degraded path may
assume personal resources are readable by crName.

Deployments gain one required setting — `JWT_INTERNAL` — and production
fails fast without it.

One ADR-0056 enforcement point is weakened by the key switch: the task engine
no longer asserts owner-equals-creator on GitHub Deployment Task creation,
because the Deployment Credential Binding's owner is now a uid while the
recorded creating actor remains a per-region crName — disjoint identifier
spaces with no equality to check. The constraint stands by construction
instead: a binding is never accepted from the request body and is resolved
server-side from the verified initiator's own connection at the single
authorization point. The engine retains its shape checks — non-GitHub tasks
must not carry a binding; GitHub tasks require a creating actor and a
current-generation binding. Recording the initiator's uid on task rows to
restore the assert was considered and rejected: existing rows are history and
stay unrewritten, and the field's only purpose would be guarding against
hypothetical future engine callers; if per-uid task attribution becomes a
product need, that is the moment to add it.

This decision revises ADR-0056's actor subject key, identity trust source, and
migration mode; ADR-0047's conversation owner key; and ADR-0036's connection
owner key and identity generation. ADR-0056's verified-actor boundary, its
ownership enforcement and fail-closed semantics, and its deferral of runtime
credential isolation all stand.
