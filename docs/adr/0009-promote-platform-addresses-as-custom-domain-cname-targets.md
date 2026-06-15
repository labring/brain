# Promote Platform Addresses as Custom Domain CNAME targets

Custom Domain Bindings reuse a Platform Address host as the CNAME target, following the existing Launchpad model. The Platform Address is promoted into the binding target: users configure their Custom Domain to CNAME to the platform host, while the user-facing Public Address display switches to the Custom Domain.

## Considered Options

- Generate an independent CNAME target per Custom Domain Binding: rejected because Launchpad already teaches users to CNAME a Custom Domain to the generated platform domain, and preserving that model avoids introducing a second invisible target identity.
- Promote an existing Platform Address host into the Custom Domain Binding target: accepted because it keeps CNAME instructions concrete, reuses the platform routing identity already allocated for the port, and matches the behavior of the existing Launchpad domain binding flow.

## Consequences

AP desired state records the user's Custom Domain Binding intent and the Platform Address identity being promoted. AP owns the public access desired state and projected status. The promoted Platform Address host remains available as the CNAME target, but the AP Settings Domain List should present the Custom Domain as the primary Public Address for that binding.

To preserve Launchpad's one-screen binding experience, Platform Address hosts need deterministic draft-visible allocation: the UI/API and AP direct renderer must be able to compute the same platform host from namespace, AP name, Platform Address ID, and routing domain before observed routing status exists. AP UID is excluded from the host slug because it is not draft-visible; observed state still decides whether the address is actually reachable.

For Platform Address health, the top-level `accessible` status means AP-owned platform routing support matches the AP's Public Address intent and target App Listening Port. A separately reported load balancer address is useful detail but is not required before the Platform Address can be considered accessible.

Submit-time CNAME verification lives in the Next.js backend that serves AP Settings, following Launchpad's existing pattern. This verification gates the local Settings Draft flow. Ongoing DNS, routing, certificate, and binding health should be projected through AP public access status.

Custom Domain Ingress and certificate resources are public access support resources owned by the AP direct orchestration path. Platform Domain Ingress continues to use the platform wildcard certificate, while Custom Domain Bindings require per-domain certificates. AP status derives each binding from AP desired network state and any observed public access support state the API chooses to project.

The AP product view is the projection boundary for Public Address health. AP list and get responses should aggregate AP-owned public access support resources into AP public access status, while AP-owned public access surfaces consume the AP status rather than monitoring those support resources independently.

Public Address health matches support resources by Public Address identity first: Platform Address IDs identify platform routing support, and Custom Domain Binding IDs identify custom-domain routing and certificate support. Hosts and domains are health evidence and display values, not the primary identity.

Unlike Launchpad, AP Settings v1 only supports CNAME verification as the submit-time ownership check. It does not include Launchpad's HTTP challenge fallback, because the Custom Domain Binding model intentionally ties the user-owned domain to a promoted Platform Address host.

Custom Domain Binding health is derived from public access support resources, not from application HTTP responses. AP public access status may record submit-time DNS verification as the DNS signal, derive certificate health from cert-manager `Certificate` conditions, and derive routing health from whether the Custom Domain Ingress matches the binding task. Business-level responses from the workload, including HTTP 404 or 500, do not make the binding unhealthy.

AP public access status projects each Custom Domain Binding with a top-level status (`progressing`, `verifying`, `accessible`, or `blocked`) and may include nested DNS, certificate, and routing details. DNS detail records persisted submit-time CNAME verification evidence; v1 does not include ongoing DNS polling, so later DNS drift is detected only when the user edits or resubmits the binding. Certificate detail is projected from cert-manager; routing detail is projected from Custom Domain Ingress configuration.

CNAME verification evidence is saved with the Custom Domain Binding intent. It is not written by the frontend into AP status and does not require a separate product resource; the AP read model combines the saved evidence with observed certificate and routing support to project Custom Domain health.

The v1 Routing Scope for duplicate Custom Domain detection is the current Kubernetes namespace. AP Settings and backend validation reject duplicate Custom Domains within the same AP and namespace-visible AP set; cluster-wide uniqueness is deferred until the platform has admission control or a public access index.
