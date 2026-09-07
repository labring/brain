# Port Display Names Live on the Service, Not the Ingress

An AP with several App Listening Ports (game 5200 / admin 5201, login 3001 /
admin 3002, S3 API 9000 / console 9001) gets one Public Address per port, and
the AP Public Access Node showed those as rows that differed only in hostname.
We wanted a user-nameable, template-presettable purpose name that Brain can
render. The question was what object owns the name.

## Decision

The name is a **Port Display Name** owned by the App Listening Port (see
CONTEXT.md). It is stored as one annotation per port on the AP's Kubernetes
Service — `brain.io/port-display-name.<port number>` — in the same `brain.io`
domain as the Resource Display Name annotation (ADR 0066). A Public Address
displays the name of the port it targets and owns no name of its own.

Resolution happens at read time in the API's AP read model, over the same
Services the read model already consults for observed Public Addresses (the
AP's own Service for Brain-created APs, the template's Services for adopted
Template Instances), in this order: the annotation (trimmed, non-empty); else
the Service port's declared `name` unless it is a generic word (`http`,
`https`, `web`, `tcp`, `udp`, `grpc`, `ws`, `port-<n>`, or all digits; no
prefix stripping, so `http-admin` stays `http-admin`); else nothing, and the
row shows the domain alone. The result is the `displayName` of each
`status.network.appListeningPorts[]` row; the UI never re-derives this rule.

Writing goes through the AP PATCH: each `spec.input.network.appListeningPorts[]`
entry accepts a `displayName`, which the API turns into the annotation on the
Service it renders; an empty or absent value clears it. Names are trimmed,
1–64 characters, any script, and unique among the AP's ports; the PATCH
rejects an over-long or duplicate name, while a create or deploy drops it
instead, because naming never fails a deploy. The Service is the only store:
Brain's desired-network annotation on the workload never carries the name, and
nothing is stamped at deploy or adoption time. Because the API re-applies the
Service as a whole object, any write that does not name the port list (a
Public Address change, a version rollback, a redeploy) copies the live
Service's names onto the rendered one first, so only an explicit port list can
clear a name.

The template convention that falls out is deliberately Brain-free: name
Service ports by purpose and keep one purpose per port. The annotation is
optional polish (a prettier or localised name).

## Considered Options

- **Annotation on the Ingress (name per Public Address)** — rejected. An
  annotation is per object, and several shipped templates (logto on
  `kb-0.9`) put two hosts in one Ingress, so the two Public Addresses could
  not be named apart without splitting templates. More fundamentally the
  purpose is a property of the port — the program decided the admin console
  listens on 5201 — so two domains reaching the same port should share the
  name, and a Custom Domain added later inherits it for free. Every
  app-store product that solved this (Home Assistant `ports_description`,
  Cloudron `httpPorts[].title`, CasaOS `x-casaos.ports[].description`,
  TrueNAS portals) names the port, not the URL.
- **Reuse the Service port `name` as the display field** — rejected. It is a
  DNS-1123 label (no spaces, no CJK), Istio claims it for protocol hints
  (`http-admin`), and every platform that gave a port one `name` spent it on
  addressing (Northflank caps it at 8 characters and its own template writes
  `p01`; Qovery turns it into the subdomain). It is a good *default*, not a
  storage location.
- **Brain's own desired-network annotation on the AP** — rejected. Only
  Brain-created APs carry it; adopted Template Instances would have no way
  to pre-name.
- **Platform database** — rejected for the reasons in ADR 0066: the cluster
  is the resource's source of truth and a side table orphans on
  cluster-side deletes.

## Consequences

- **Deviation from ADR 0066's "reading never derives".** ADR 0066 rejected
  read-time defaults because a derived name looks authoritative while being
  persisted nowhere, cannot be numbered, and drifts when the image or labels
  change. The Service port name is none of those: it is an author-written
  field already stored on a cluster object, it needs no numbering because
  ports are already distinct, and it does not move with the image. Treating
  it as a fallback is reading a second stored field, not deriving. Writing
  it into the annotation would add a Service write to adoption and deploy
  for no user-visible gain.
- Platform Address and Custom Domain remain glossary terms and keep their
  distinct behaviour (CNAME verification, bind/unbind, health states), but
  they are no longer shown as row labels: the hostname already carries that
  information and the label was displacing the one that mattered.
- ADR 0079's Deployment Access Endpoint carries a user-facing label for the
  deployment Timeline and notes that richer product labels await a Template
  Runtime Contract. The Port Display Name is the natural source for that
  label once both exist; this ADR does not wire them together. WS/WSS Public
  Addresses (ADR 0079) group under their port like any other row and stay
  copy-only.
- Which Public Address is the "open the app" link (a primary marker, as in
  Qovery `is_default` or Cloudron `httpPort`) is a separate decision and is
  deliberately not addressed here.
