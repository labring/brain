# Pin the Current Billing Region by Deployment-Declared Domain

account-service stores every Workspace Subscription under `(workspace,
regionDomain)`, so each subscription query and payment action Brain sends is
region-addressed. account-service's `/regions` endpoint returns the global
region catalog in configuration order and does not say which entry the
serving cluster belongs to; upstream lookups keyed on a wrong domain resolve
silently to "no subscription" — the PAYG shape — rather than an error.

The billing loaders used to take `regions[0]` as the deployment's own region.
With more than one region in the catalog and the wrong one listed first, a
paid workspace renders as Pay-As-You-Go (subscribe button offered, AI Credits
suppressed, card on file hidden) and a confirmed plan purchase creates a
subscription bound to the wrong region. The legacy costcenter guarded exactly
this with a `cloud.regionUid` config entry, a lookup against the catalog, and
a hard error on a miss; the rewrite lost the guard and kept the index habit.

## Decision

The deployment declares which region it belongs to, and the declaration is
verified against the catalog before anything trusts it:

- `BILLING_LOCAL_REGION_DOMAIN` names the Current Region's domain — the same
  deployment-declared fact account-service itself configures as
  `LocalRegionDomain`, and the identifier every downstream subscription query
  actually consumes (unlike the legacy `regionUid`, which always needed one
  more catalog round-trip to become a domain). The brain-system chart derives
  it from the platform cloud domain when unset, so a standard install carries
  no new required value.
- The `/api/billing/regions` route resolves the declaration against the
  upstream catalog and returns the catalog with the matched entry marked as
  `current`. Loaders read the mark; no consumer reads a catalog index, and
  the catalog's order stays meaningless.
- Resolution failures — unset declaration, domain absent from the catalog,
  unreadable catalog — fail the route with an explicit error, so the Billing
  Area shows a load failure instead of another region's answers. The failure
  is scoped to billing routes, not process startup: Brain is not a
  billing-only app, and a billing misconfiguration must not take down the
  rest of the product.

## Considered Options

- Keep `regions[0]` with the legacy server-side swap (reorder the current
  region to the front): rejected. It fixes the data but preserves the
  positional convention whose silent loss caused this bug; the next reader
  of `regions[0]` has no reason to know index 0 is special.
- Derive the region from the request kubeconfig's cluster host
  (`routingDomainFromKubeconfig`, as the card-manage return URL does):
  rejected as the primary source. It rests on the unwritten equality
  "kubeconfig server host == region domain", and a billing-correctness
  anchor deserves an explicit declaration over an inferred one.
- Ask account-service which region is local: no such endpoint exists
  (`LocalRegionDomain` is config it never exposes), and waiting on an
  upstream API change would block the fix.
- Fall back to `regions[0]` when resolution fails: rejected. A wrong billing
  page misprices workspaces and directs real payments at the wrong region;
  an error page is strictly cheaper.

## Consequences

Every real deployment must present a resolvable region domain: explicitly
via `BILLING_LOCAL_REGION_DOMAIN`, or implicitly via the chart's cloud-domain
derivation. A cluster whose serving domain deliberately differs from its
catalog domain must set the variable explicitly, and a misdeclared domain now
fails loudly on the first billing load instead of silently mispricing.

The regions response is no longer a verbatim upstream proxy: it carries the
`current` mark, and the dev-mock fixture answers in that marked shape (the
one fixture that mocks the route contract rather than the upstream shape).

Payment-to-region attribution (the Costs view's Region Cost) builds on the
same Current Region fact; a future multi-region overview would reuse the
mark and the catalog but additionally needs a per-region data channel, which
this decision neither provides nor obstructs.
