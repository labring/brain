# Promote Platform Addresses as Custom Domain CNAME targets

Custom Domain Bindings reuse a Platform Address host as the CNAME target, following the existing Launchpad model. The Platform Address is promoted into the binding target: users configure their Custom Domain to CNAME to the platform host, while the user-facing Public Address display switches to the Custom Domain.

## Considered Options

- Generate an independent CNAME target per Custom Domain Binding: rejected because Launchpad already teaches users to CNAME a Custom Domain to the generated platform domain, and preserving that model avoids introducing a second invisible target identity.
- Promote an existing Platform Address host into the Custom Domain Binding target: accepted because it keeps CNAME instructions concrete, reuses the platform routing identity already allocated for the port, and matches the behavior of the existing Launchpad domain binding flow.

## Consequences

AP desired state records the user's Custom Domain Binding intent and the Platform Address identity being promoted. EntryPoint owns DNS verification, routing, certificate lifecycle, and binding status. The promoted Platform Address host remains available as the CNAME target, but the AP Settings Domain List should present the Custom Domain as the primary Public Address for that binding.

To preserve Launchpad's one-screen binding experience, Platform Address hosts need deterministic draft-visible allocation: the UI/API and AP direct renderer must be able to compute the same platform host from namespace, AP name, Platform Address ID, and routing domain before observed routing status exists. AP UID is excluded from the host slug because it is not draft-visible; observed state still decides whether the address is actually reachable.

Submit-time CNAME verification lives in the Next.js backend that serves AP Settings, following Launchpad's existing pattern. This verification gates the local Settings Draft flow, while EntryPoint remains responsible for authoritative ongoing DNS, routing, certificate, and binding health after save.

Custom Domain Ingress and certificate resources are public-entry support resources owned by the AP direct orchestration path. Platform Domain Ingress continues to use the platform wildcard certificate, while Custom Domain Bindings require per-domain certificates. The EntryPoint API view derives each binding from the per-binding Custom Domain Ingress, namespaced cert-manager `Issuer`, and cert-manager `Certificate`.

Unlike Launchpad, AP Settings v1 only supports CNAME verification as the submit-time ownership check. It does not include Launchpad's HTTP challenge fallback, because the Custom Domain Binding model intentionally ties the user-owned domain to a promoted Platform Address host.

Custom Domain Binding health is derived from public-entry resources, not from application HTTP responses. EntryPoint records submit-time DNS verification as the DNS signal, derives certificate health from cert-manager `Certificate` conditions, and derives routing health from whether the Custom Domain Ingress matches the binding task. Business-level responses from the workload, including HTTP 404 or 500, do not make the binding unhealthy.

EntryPoint status projects each Custom Domain Binding with a top-level status (`pending`, `verifying`, `accessible`, or `blocked`) plus nested DNS, certificate, and routing details. DNS detail records the submit-time CNAME verification result and may be `unknown` after save because v1 does not include ongoing DNS polling; certificate detail is projected from cert-manager; routing detail is projected from Custom Domain Ingress configuration.

The v1 Routing Scope for duplicate Custom Domain detection is the current Kubernetes namespace. AP Settings and backend validation reject duplicate Custom Domains within the same AP and namespace-visible EntryPoint/AP set; cluster-wide uniqueness is deferred until the platform has admission control or a public-entry index.
