# Model Public Entry Points as Deployment Access Endpoints

## Context

Deployment Tasks exposed user-facing addresses through three incompatible
paths. Direct AP deployments created a `PublicAccess` result without carrying
the provider-assigned URL into the success record. Templates created a
`TemplatePublicAccess` result from Ingress rules. Agent-managed GitHub
deployments bypassed result cards and reported one optional `publicUrl`.

The split let an nginx deployment reach `completed` with an accessible platform
address while the success card showed no address. It also could not represent a
product such as Eaglercraft with a web client and a WebSocket game endpoint
without inventing protocol semantics in the UI.

## Decision

`AccessEndpoint` is the canonical Deployment Result Resource for a declared
user-facing entry point, independent of deployment source. It has:

- a stable task-local id and user-facing label;
- an explicit `http`, `https`, `ws`, or `wss` protocol;
- an optional URL while the provider is still assigning it;
- an observer identity for an AP public address, Ingress, or an already
  declared URL; and
- the existing result-card `required` flag, which decides whether endpoint
  readiness gates task completion.

New deterministic writers use `AccessEndpoint`. Historical `PublicAccess` and
`TemplatePublicAccess` references remain readable because task history is
permanent. Timeline JSON remains the persistence boundary; this decision adds
no database table and performs no read-path backfill.

An AP public address is observed by AP name plus address id. Brain reads the
provider-assigned URL from the AP Product View and never reconstructs it from a
prefix, namespace, port, or cluster convention.

A template Ingress supplies host, TLS, and ordered path candidates, but those
paths are routing implementation rather than independent user entry points.
Brain groups candidates by hostname and endpoint role, retaining at most one
HTTP(S) address and one WS(S) address for each host. A declared root path wins;
a path-only app retains one primary path chosen by the entry-path rule below.
Only retained entries are probed and gate completion. This keeps `/api`, static
assets, and secondary admin routes from becoming deployment requirements when
the primary app is already usable.

For an inferred non-root HTTP(S) Ingress candidate returning 404, observation
may verify `/` on the same origin. Only a successful root probe replaces the
candidate URL and label in the running task; its card identity stays stable.
This is endpoint discovery, not acceptance of a 404 as healthy. Root failures,
other HTTP errors, explicit URL declarations, and AP-assigned addresses retain
their existing gates. Completed task history is not rewritten.

Some existing catalog templates use `backend-protocol: WS|WSS` as a legacy
marker for a public WebSocket entry. Brain preserves that marker narrowly for
compatibility and verifies one matching WS or WSS address; it is not treated as
general ingress-nginx protocol semantics, and Brain never derives WebSocket
support from TLS or a product name.

A WS/WSS-marked Ingress supplies only the matching WebSocket endpoint, never
an additional required HTTP GET endpoint. A separate HTTP Ingress on the same
host retains its own primary path, including an admin path. AP Network projects
the same protocol evidence by Service and backend port, preserving separate
public addresses on a shared hostname and correcting generated URL schemes
without changing routing health or desired configuration.

Agent-managed completion accepts at most eight `accessEndpoints`, each with a
stable id, label, and exact URL. The v1 `publicUrl` field remains an input
compatibility adapter and becomes one HTTP endpoint when the new array is
absent. Brain validates the protocol, credentials, fragment, and tenant-domain
boundary, then verifies every endpoint. HTTP(S) verification requires a
successful application response and follows redirects only while every target
remains in the tenant domain. WS(S) verification requires the WebSocket
upgrade to open. A failed required probe prevents completion.

Agent-managed completion projects every verified endpoint and independently
observed runtime into required Timeline result cards before deriving the
Success Record. Services, Ingresses, PVCs, and other supporting objects remain
in the artifact summary but do not inflate the user-visible verification count.

The Success Record contract advances to v2 and includes the verified endpoint
protocol. HTTP(S) entries may be opened and copied. WS(S) entries are copied,
not opened as browser pages. A result with verified resources but no access
endpoint uses the neutral headline `Deployment completed`; `You can start
using it` is reserved for results with an actionable verified entry.

## Considered Options

- Add the resolved URL to `PublicAccess` only: rejected because it fixes Docker
  while preserving separate Docker, Template, and Agent result contracts.
- Derive WSS from an HTTPS Ingress: rejected because TLS does not declare an
  application WebSocket path or subprotocol.
- Treat every Ingress path or every HTTP response as a usable entry: rejected.
  Route paths are not product-entry metadata, and accepting a 404 would turn a
  broken link into a success claim.
- Backfill historical timelines: rejected because task reads never write and a
  historical probe cannot reproduce what was verified at completion time.

## Consequences

- nginx and other direct web deployments wait for both workload readiness and
  a resolved, reachable platform address, then show that exact address.
- Templates show one primary verified web address per Ingress hostname.
  Catalog templates carrying the legacy WS/WSS marker also show one separately
  verified WebSocket address. Richer product-specific labels and probes still
  belong in a future versioned Template Runtime Contract.
- GitHub deployments can report multiple independently labelled web and
  WebSocket endpoints while old deployment skills continue to work.
- Rollback may stop writing v2 records, but readers must retain v1 and v2
  support after any v2 task has been persisted.

## Amendment: the entry-path rule (2026-09)

The original text let a path-only host keep "its first manifest-ordered
path". Ingress path order carries no routing meaning, and a survey of the
245-template catalog showed the one path-only HTTP entry in it, the
Eaglercraft admin panel, declares `/api` first and `/admin` fifth, so the
rule opened a 404. The rule is now:

1. A declared root (`/`) wins outright.
2. Otherwise paths whose last segment carries a short file extension
   (`/admin.css`) step aside: they are assets routed next to a page.
3. Among the rest, the path that the most other declared paths extend is the
   entry (`/admin` for `/admin.css`, `/admin.js`, `/admin-i18n.js`). A tie
   keeps manifest order.

Regex paths contribute their literal head (`/admin(/|$)(.*)` is `/admin`,
`/?(.*)` is `/`). Across the catalog the rule changes exactly one choice, the
Eaglercraft one, and no others; a name denylist (`api`, `ws`, `auth`, ...) was
rejected because it changed five and got four wrong.

The AP read model applies the same rule to observed Public Addresses, so the
Public Access Node, the Open control, and the Domain List agree with the
deployment result card. Because a Public Address now carries a path, the
automatic Default Open Port rule prefers a port whose HTTP Public Address
enters at the root before any port that enters under a path; otherwise a
backend port declared before the page port (`/api/v1` on Pangolin, `/mqtt`
on EMQX) would have become the Open target.
