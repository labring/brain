# Establish the Brain Session from the Desktop Login Cookie

## Status

Proposed (2026-09-14); pending team review of the session-model decisions.
Revises two premises of ADR-0059 (see "Revisions to earlier ADRs").

Brain has never held a session of its own. It runs inside the Sealos Desktop
iframe and receives its credentials once, at mount, through the Desktop SDK's
`getSession()`: the kubeconfig, the desktop-minted app token, and the user's
display data. That is enough to act inside the one Workspace Desktop chose,
and nothing more. Switching Workspaces from inside Brain and managing them
(members, roles, invitations, transfer, deletion) need the Desktop **regional
token**, which the SDK never delivers and the Desktop Workspace routes alone
accept. Brain therefore needs a way to obtain Desktop credentials itself.

## Decision

### Exchange the shared login cookie through the Brain server

Desktop writes its **global token** into the shared login cookie
`sealos_auth_token` on the parent domain (`.<registrable domain>`, seven days,
not HttpOnly). Brain is deployed at `brain.<cloudDomain>`, same site as
Desktop, so the browser attaches that cookie to Brain's own same-origin
requests. The **Brain Session** is established by one route handler,
`POST /api/session`, whose server side reads the cookie and calls Desktop:
`regionToken` (always lands in the Personal Workspace), then, when the
requested Workspace differs, `namespace/switch`, then `auth/info` for the
user's display data. The result is the regional token, the app token, the
kubeconfig with its context namespace rewritten to the target Workspace, the
Workspace list, and the user.

The browser never calls Desktop. Desktop's `/api/auth/*` routes carry no CORS
headers, and every Desktop call needs a custom `Authorization` header, so a
direct call is blocked by preflight. The Brain server reaches Desktop over its
in-cluster Service address (`DESKTOP_API_BASE_URL`, derived by the chart like
`ACCOUNT_API_BASE_URL`); local development points it at a staging Desktop.
Brain exposes **purpose-built route handlers**, never a generic pass-through
to Desktop paths: each handler translates Desktop's "HTTP 200 with the
business code in `body.code`" convention into real HTTP statuses and
validates the response shape. The page depends only on Brain's own contract.

`regionToken` answering `409 workspace is not inited` is treated as an
anomaly (logged, surfaced as the generic session error), not repaired: Brain
does not call `autoInitRegionToken`, because establishing a session must
never create a Workspace as a side effect.

### Hold the session in page memory only

The three credentials live in Jotai atoms for the lifetime of the tab. Brain
writes no cookie and no storage of its own. A reload re-establishes the
session from the shared cookie. The regional token travels back to the Brain
server in a third credential header, `X-Sealos-Region-Token`, attached only
by Workspace-management fetchers and read only by Workspace-management
routes, mirroring `X-Sealos-App-Token` (ADR-0059). Kubernetes requests keep
the kubeconfig in `Authorization: Bearer`; personal-resource requests keep
the app token in `X-Sealos-App-Token`. Three credentials, three headers, each
present only on the routes that consume it.

### Desktop owns the current Workspace while Brain runs in its iframe

Desktop enforces one Workspace per browser: its switcher listens to the
`storage` event and reloads every other tab the moment one tab switches, and
its home page honours `?workspaceUid=` on load by calling its own `switch`.
Brain inside that iframe therefore **does not remember a current Workspace**.
At start it asks the SDK for Desktop's current `nsid`, resolves the uid from
the Workspace list it fetches anyway, and aligns to it. A `nsid` no longer in
the list falls back to the Personal Workspace with a visible notice, as
Desktop itself does.

Brain's Workspace switcher does not switch. On click it hands the top-level
window to Desktop: `https://<cloudDomain>/?openapp=system-brain&workspaceUid=<uid>`.
Desktop switches, every tab converges, Desktop reopens Brain, and Brain
re-establishes its session in the new Workspace. This needs no upstream
change and gives Brain's switch the exact feel of Desktop's own. Outside an
iframe (`window.top === window`, i.e. local development) the switcher hides
or points at the local dev bridge instead.

### The SDK provides Desktop state, never credentials

Brain keeps the SDK for five things: the `createSealosApp` handshake,
`getSession` **read only for `user.nsid`**, `getHostConfig` for the Desktop
domain, the `CHANGE_I18N` language event, and `openApp`. The SDK reader's
return type has no `kubeconfig`, `token`, or user-display fields, so no
fallback to SDK-delivered credentials can be added without changing a type.
User display data comes from Desktop's `auth/info` through `/api/session`.

### Local development runs the real path against staging

Without a Desktop shell, `DEV_GLOBAL_TOKEN` stands in for the shared cookie
(decided with the login handling); the server otherwise runs the same code.
The app token that staging Desktop mints is signed with staging's
`jwtInternal`, so the developer's `.env.local` carries staging's
`JWT_INTERNAL`, which ADR-0060's account-service calls already require. The
self-signed development pair (`NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG`,
`NEXT_PUBLIC_DEV_APP_TOKEN`, `scripts/mint-dev-app-token.mjs`,
`hasDevCredentialBypass()`) is removed. The Sealos App Dev Bridge extension
keeps answering the SDK on `localhost`; Brain reads only `nsid` from it, so
the bridge needs no change.

## Considered Options

- Keep obtaining credentials through the SDK and add only the regional token
  upstream: rejected with the login handling — the SDK path is the iframe
  premise this map retires, and a second credential channel would coexist
  with the cookie path indefinitely.
- Hold the regional token and app token in a Brain-owned HttpOnly cookie so a
  reload costs one call and the current Workspace survives it: rejected. A
  cookie is shared by every tab, so one tab's switch silently changed the
  Workspace another tab's server calls acted in, and it duplicated a memory
  Desktop already owns and enforces. Per-tab `sessionStorage` was rejected
  for the mirror reason: it can disagree with the Desktop shell in the same
  tab after Desktop reloads.
- Let Brain switch itself via Desktop's `switch` and then tell Desktop:
  rejected for now — Desktop has no channel to be told (the SDK event bus
  registers four events, none for switching), so a switch Brain performs
  alone leaves the Desktop top bar and every other tab in the old Workspace.
  A `switchWorkspace` SDK event is a candidate upstream change that would
  replace the URL hand-off, not the model.
- Fetch the namespace-patched kubeconfig from Desktop's `getKubeconfig`
  instead of rewriting `contexts[0].context.namespace` locally: rejected in
  favour of mirroring Desktop's own seven-line rewrite, saving a call; the
  server decodes (without verifying — Brain holds no regional key) the token
  Desktop just returned and trusts `contexts[0]`, as Desktop does.
- Establish the session during React Server Component render: rejected —
  the SDK's `nsid` is only available in the browser, so render could only
  land in the Personal Workspace and alignment would need a second path.
- A generic `/api/desktop/[...path]` proxy: rejected — it exposes every
  Desktop route (account, real-name, top-up) to page code, forces the
  regional token into page JS for arbitrary use, and repeats the status
  translation at every call site.
- Skip app-token verification in development, or re-sign staging tokens
  with a local key: rejected — ADR-0059 forbids development branches in the
  verifier, and re-signing is forging.

## Revisions to earlier ADRs

ADR-0059 recorded that "desktop mints the token only at login, region switch,
and workspace switch and never refreshes it". Brain now has Desktop mint a
fresh app token at every Brain start (every Desktop reload). The Identity
Fingerprint rule is unaffected — a re-mint for the same `userUid` is always a
`match` — and expiry stays unenforced for the reasons ADR-0059 gives; only
the frequency premise changes. ADR-0059's "Keep one code path everywhere"
paragraph described local development as minting a real token with a dev
`JWT_INTERNAL` and a script; that is replaced by the staging path above.

ADR-0056's and ADR-0059's credential prohibition extends to the regional
token and the global token: neither may appear in logs, telemetry, audit
records, or API responses, and the shared login cookie's value is forwarded
to exactly one place, Desktop's `regionToken`.

## Consequences

Brain gains a session service module with a single entry (`/api/session`)
used for start, reload, and the silent 401 re-exchange; one new server
setting, `DESKTOP_API_BASE_URL`; one new credential header; and no
persistence. The current Workspace has one owner, Desktop, so there is no
cross-tab or shell-versus-content inconsistency to reconcile. Every Brain
start costs three Desktop calls (`regionToken`, `switch` when not Personal,
and the list it needs regardless); a per-tab cache can shave that later
without changing the model.

The decision is scoped to the iframe period. When Brain opens standalone
there is no Desktop shell to own the current Workspace, and Brain will need
its own memory of it; that is a later decision, not a gap in this one.
Candidate upstream changes recorded for the Sealos change list: a
`switchWorkspace` SDK event; a single Desktop session endpoint that takes the
global token and a Workspace uid and returns all four artefacts at once
(which would remove the local kubeconfig rewrite and the separate
`auth/info` call); and letting every Workspace-management route accept the
app token, which would make the regional token, and with it most of this
session, unnecessary while Brain stays inside the iframe.
