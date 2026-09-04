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
prefix, namespace, port, or cluster convention. A template Ingress declares
exact paths and HTTP or HTTPS according to its rule and TLS host coverage. The
existing nginx `backend-protocol: WS|WSS` annotation is an explicit WebSocket
declaration, so Brain also verifies the matching WS or WSS endpoint; Brain
never derives WebSocket support from TLS or a product name. Because the
annotation applies to the whole Ingress, each path declared by that Ingress is
retained and verified independently; a root path never hides a more specific
path.

Agent-managed completion accepts at most eight `accessEndpoints`, each with a
stable id, label, and exact URL. The v1 `publicUrl` field remains an input
compatibility adapter and becomes one HTTP endpoint when the new array is
absent. Brain validates the protocol, credentials, fragment, and tenant-domain
boundary, then verifies every endpoint. HTTP(S) verification requires a
successful application response and follows redirects only while every target
remains in the tenant domain. WS(S) verification requires the WebSocket
upgrade to open. A failed required probe prevents completion.

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
- Backfill historical timelines: rejected because task reads never write and a
  historical probe cannot reproduce what was verified at completion time.

## Consequences

- nginx and other direct web deployments wait for both workload readiness and
  a resolved, reachable platform address, then show that exact address.
- Templates show every verified Ingress path through the same result type.
  Ingresses that explicitly declare an nginx WS/WSS backend also show a
  separately verified WebSocket address. Richer product-specific labels and
  probes still belong in a future versioned Template Runtime Contract.
- GitHub deployments can report multiple independently labelled web and
  WebSocket endpoints while old deployment skills continue to work.
- Rollback may stop writing v2 records, but readers must retain v1 and v2
  support after any v2 task has been persisted.
