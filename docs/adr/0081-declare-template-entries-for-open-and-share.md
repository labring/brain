# Declare Template Entries for Open and Share

## Context

After a template deployment, Brain decides two addresses on the user's
behalf: the one its Open control opens, and the one the Deployment Task
Success Record's share strip copies, shows as a QR code, or posts. Both were
inferred. Open followed the Default Open Port rule (CONTEXT.md; ADR 0079's
amendment; ADR 0080's store) over the AP's observed Public Addresses, and the
share strip shared whatever came first. For most catalog templates that is
right. For a product whose page is not the routing root it is not: the
EaglerCraft template serves a WebSocket game at `/` and its admin console at
`/admin`, and its browser client is joined through a query-string URL
(`/?server=wss://…`) that no Ingress path names. No rule over Ingress paths
can know that the console is what to open and the join link is what to
share — only the template author does.

Two facts made the gap avoidable. 212 of the 256 catalog templates already
apply a Sealos App CR (`app.sealos.io/v1` `App`) whose `spec.data.url` is the
address the Sealos desktop launcher opens; Brain applied that object and never
read it. And every Ingress host of a template deployment is already a
required Deployment Access Endpoint (ADR 0079) whose probe gates the Success
Record — so a declared URL on one of those hosts stands on verified ground.

CONTEXT.md's Default Open Port entry said "there is no Project-level or
Template-Instance-level open link". The product owner decided on 2026-09-08
that a template may declare its entries; this record documents that decision
and revises the sentence.

## Decision

A Sealos Template may declare **Template Entries** in its header:

```yaml
spec:
  entries:
    open: https://${{ defaults.app_host }}.${{ SEALOS_CLOUD_DOMAIN }}/admin
    share: https://${{ defaults.app_host }}.${{ SEALOS_CLOUD_DOMAIN }}/?server=wss://${{ defaults.app_host }}.${{ SEALOS_CLOUD_DOMAIN }}/
```

Both are full URLs rendered with the same `${{ }}` substitution as every
resource document (defaults, inputs, `SEALOS_*` values). Both are optional.

**Open** is the URL the Open control opens after the deployment. Its fallback
chain: the declared `entries.open`; else the template's App CR
`spec.data.url`; else the automatic Default Open Port rule, unchanged.

**Share** is the URL the Success Record's share strip shares. Its fallback:
the declared `entries.share`; else the Open URL, which is what the strip
shared before. Share never falls back to the App CR URL on its own: some App
CR URLs embed a secret (`#token=…`, `/invite/<code>`) that must not be posted
to a social network. It only ever equals `entries.share` or the resolved Open
URL.

**No probe.** A Template Entry is not a Deployment Access Endpoint and is not
probed. It is kept only when an Ingress of the same deployment serves its
host (the boundary below), and every such host is a required Deployment
Access Endpoint whose probe already gates the Success Record — so the entry's
host is verified before the record exists. What a probe of the full URL
would add is whether the application answers on that path or query string
at that moment, and that is not routing health: CONTEXT.md's AP Public
Access Health already says a workload 404 or 500 does not make an address
unhealthy. So the record takes the entries as declared, and a template's own
mistake in a path is the template author's to see and fix, not a reason to
fall back silently. The Open Entry is the record's first entry; when an
Ingress card already lists the same URL the card's entry stands (the record
de-duplicates by full URL), else the entry is added as declared, headed by
the App Listening Port it reaches when an AP of the task observed that
address and by nothing otherwise. The Share Entry is not listed as an entry
at all: it is the address the share strip shares, and only that. Only an
HTTP(S) Share Entry is shared: a `ws://` or `wss://` address cannot be opened
from a link or a QR code, so such a Share Entry yields to the Open URL exactly
as if none were declared (the record's `shareUrl` is never a socket address).

**Consistency with the AP.** When the Open URL — declared or from the App CR
— can be matched to one App Listening Port of one of the deployment's APs,
Brain writes `brain.io/default-open-port: "<port>"` onto that AP's Service
at render time — at read-back time for a template the provider applied —
unless the template already set it. The match: the URL host
equals an Ingress rule host in the rendered documents; the rule path that is
the longest prefix of the URL path is followed to its backend Service and
port (a named port resolved through the Service's own `spec.ports`). No
match writes nothing. The annotation is Brain's own bookkeeping (ADR 0080's
store, read through `status.network.defaultOpenPort`), so the AP Public
Access Node's Open and the record's Open agree.

**Boundary.** An entry is kept only when an Ingress of the same deployment
serves its host. Brain never surfaces an address the deployment did not
create, and — for a provider-applied template whose defaults Brain re-reads
off the Instance CR — an unresolved expression can never leak into a URL.
Credentials and fragments disqualify an entry outright.

**Where it runs.** Brain renders some templates itself and defers others to
the template provider. In Brain's renderer the rules run over the documents
it is about to apply, and the annotation ships with the Service. For a
provider-applied template Brain reads the same facts back once the Ingresses
exist — the declared entries off the template source, the resolved defaults
off the Instance CR, the inputs from the run's memory, the Ingresses,
Services, and App CR from the cluster — then applies the same pure rules and
patches the matched Service. Entries are advisory there: a failed read
degrades to no declared entry, never to a failed deployment.

**The record.** The Success Record snapshots its share address as
`shareUrl`, next to the entries. A record written before the field existed
shares its primary HTTP(S) entry, as it always did.

## Considered Options

- **Keep inferring from Ingress paths** — rejected. The entry-path rule (ADR
  0079 amendment) already picks the best routing candidate; a join link with
  a query string is not a routing candidate at all.
- **Read only the App CR, no `entries` field** — rejected as the whole
  answer, kept as the fallback. The App CR URL is written for the Sealos
  desktop launcher and may carry a secret, so it can preset Open but never
  Share; and it cannot name a second, share-specific URL.
- **Let Share fall back to the App CR URL** — rejected: `#token=` and
  `/invite/<code>` URLs exist in the catalog today.
- **Probe each entry as a Deployment Access Endpoint** — rejected, in two
  strengths. As a completion gate, 212 templates would gain a new required
  probe overnight for a URL nobody has checked. As optional evidence, a
  failed probe would silently swap the declared Open for the automatic rule
  while the Service annotation still named the declared port, and the user
  would see two different Opens with no explanation. Either way the probe
  verifies application response on a path, which the AP Public Access Health
  definition already excludes from health; the host is verified by the
  Ingress endpoint's own required probe.
- **List the Share Entry as a record entry** — rejected: the record's entries
  are ways the user reaches the product, each headed by the port it reaches;
  the share link is an address for other people and would be the one entry
  with a label of its own, next to a near-duplicate of the Open URL.
- **Name the port on the Ingress or a new CR** — rejected; ADR 0080 settled
  that port facts live on the Service.

## Consequences

- CONTEXT.md's Default Open Port no longer says a Template Instance has no
  open link: a template presets its AP's Default Open Port through its
  entries, and the store, read path, and user override stay exactly ADR
  0080's. The glossary gains Template Entry.
- ADR 0079's Deployment Access Endpoint contract is untouched: a Template
  Entry is not an endpoint, adds no card to the Deployment Task Timeline, and
  never counts toward the record's verification summary. The Open Entry
  borrows only the endpoint naming rule (the Port Display Name of the App
  Listening Port it reaches).
- ADR 0080's note that "a template can preset" the Default Open Port now has
  a second writer: Brain itself, from the template's entries, at render or
  read-back time, and only where the template left the annotation empty.
- Template authors get one explicit place to say what opens and what is
  shared; the 212 App CR templates get the right Open without editing.
- The Success Record contract gains an optional `shareUrl`; readers keep
  accepting records without it.
