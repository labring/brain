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
read it. And ADR 0079 already has a contract for a declared, probe-verified
URL — the one GitHub Agent-declared endpoints use.

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

**Verification.** A Template Entry is a Deployment Access Endpoint with a
declared URL — ADR 0079's contract. It is probed like any HTTP or WebSocket
endpoint, verbatim: a share URL keeps its query string, the GET is on the
full URL, and endpoints are de-duplicated by full URL, so an Open entry that
names the address an Ingress card already observes adds no second card. Only
a verified entry enters the Success Record. Unlike an Agent-declared
endpoint, a Template Entry does not gate completion: the Ingress-derived
entries already gate usability, and a declared link that fails its probe is
left out of the record rather than failing a deployment that works. A
declared Open entry the probe did not confirm leaves the automatic rule in
charge; an unconfirmed Share entry leaves the Open URL shared.

**Consistency with the AP.** When the Open URL — declared or from the App CR
— can be matched to one App Listening Port of one of the deployment's APs,
Brain writes `brain.io/default-open-port: "<port>"` onto that AP's Service
at render time, unless the template already set it. The match: the URL host
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
- **Make Template Entries gate completion like Agent-declared URLs** —
  rejected for this field: 212 templates would gain a new required probe
  overnight, and the Ingress-derived entries already prove usability.
- **Name the port on the Ingress or a new CR** — rejected; ADR 0080 settled
  that port facts live on the Service.

## Consequences

- CONTEXT.md's Default Open Port no longer says a Template Instance has no
  open link: a template presets its AP's Default Open Port through its
  entries, and the store, read path, and user override stay exactly ADR
  0080's. The glossary gains Template Entry.
- ADR 0079's "declared URL" observer family gains a template-declared kind
  that is named like an Ingress host once verified (Open) or keeps its
  declared label (Share); its statement that a failed required probe
  prevents completion is unchanged, since Template Entry cards are optional.
- ADR 0080's note that "a template can preset" the Default Open Port now has
  a second writer: Brain itself, from the template's entries, at render or
  read-back time, and only where the template left the annotation empty.
- Template authors get one explicit place to say what opens and what is
  shared; the 212 App CR templates get the right Open without editing.
- The Success Record contract gains an optional `shareUrl`; readers keep
  accepting records without it.
