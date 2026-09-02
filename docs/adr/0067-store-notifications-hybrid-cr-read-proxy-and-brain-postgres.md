# Store Notifications Hybrid: Read Platform CRs Live, Keep Brain's Own in App Postgres

The Notification Center is the user's single inbox for platform messages
(the account and workspace-subscription controllers' debt ladder) and
Brain-produced messages (quota exhausted, and later the gift hint and
subscription-change receipts). The platform already carries its messages as
Notification CRs (`notifications.notification.sealos.io/v1`) in every user
namespace, with special semantics Brain cannot reproduce: fixed names per
scenario overwritten in place, a revive to unread on escalation, and an
automatic read-back on recovery. Brain, in turn, holds no standing cluster
credentials — every request arrives with the user's own kubeconfig
(ADR-0052) — and no controller of its own.

## Decision

Each message has exactly one source of truth, chosen by who produces it.

- **Platform messages are read live from the cluster and never copied.** The
  Go API serves a read proxy (`/api/notification/v1alpha1`) that lists the
  current namespace's Notification CRs with the caller's kubeconfig bearer
  token and merge-patches the same `isRead` label the Sealos desktop writes.
  The client polls it at the desktop's cadence (≤5 minutes). The display
  layer may substitute Brain-voiced copy and a CTA for the known fixed-name
  debt-ladder CRs and hide the low-balance tiers from gift-only newcomers —
  display-only: the CR is never touched, and unknown names show upstream's
  text as written.
- **Brain-produced messages live in Brain's own Postgres** under a new schema,
  `sealai_notification`: `notification_messages` (namespace, kind, project,
  structured payload, `dedupe_key`, optional `user_uid`) rendered
  client-side. A message is workspace-scoped (its namespace is the inbox,
  like the rest of the app's schemas) or account-scoped (`user_uid` names
  the person, the row follows them into every workspace's inbox, and the
  namespace only records where it was first observed — the gift hint, later
  the expiry reminder). An inbox lists its workspace's rows plus its
  person's account rows. Producers write at
  natural observation points during user requests — no scheduler, no
  controller. The dedupe key is the idempotency mechanism (naming is dedupe;
  a partial unique index spans live keys, and recovery releases the key so a
  re-entry writes a fresh entry while history stays). Retention is 365 days,
  swept opportunistically on every write.
- **Read state is a per-user, additive receipt** (`notification_read_receipts`:
  user × message key × read_at). The key is the source-prefixed notification
  id — `db:<id>` for Brain entries, `cr:<name>:<timestamp>` for platform CRs,
  versioned by the CR's own timestamp so an upstream revive reads as unread
  again. No workspace in the key: upstream writes account-level messages
  into every user namespace, and a person reads a message once. Any role can mark anything read; Owners and Managers
  additionally patch the CR label best-effort for desktop parity, Developers
  skip. A platform message is unread iff the label says unread and no receipt
  exists; upstream's auto-read stacks on top with no reconciliation.
- **The frontend merges the two streams** into one list sorted by real time,
  with `cr:`/`db:` id prefixes and per-source mark-read dispatch.

## Considered Options

- **All-CRD: Brain writes its own messages as Notification CRs too.** The
  survey (AIM-316) showed this would make Brain's events visible in the
  desktop's own inbox for free. Rejected: writing CRs needs a
  ServiceAccount with cluster-wide `notifications` create/update (the
  "architecture D" controller verified in AIM-321), which means standing
  credentials, a deployment surface Brain does not have today, and a
  per-user-namespace fan-out for every producer. Fixed-name overwrite
  semantics also cannot represent history ("one entry per threshold
  crossing").
- **Full mirror: ingest every platform CR into Brain's store and serve from
  there.** Rejected: it duplicates the source of truth for messages whose
  lifecycle (overwrite, revive, auto-read) the platform owns, so the mirror
  is wrong whenever the watch lags and would need reconciliation logic for
  every upstream rule. Brain would also need credentials to watch namespaces
  it is not currently serving.
- **Ingest-on-read: copy CRs into the store when a user opens the inbox,
  then serve the copy.** Rejected: it inherits the mirror's staleness for
  exactly the revive and auto-read cases that matter most, adds a write to
  every read, and buys nothing the live read does not already give.

The pivot that decided it: **Brain holds no standing credentials.** Every
option that writes or watches cluster state outside a user's request needs
credentials Brain does not have; reading with the caller's kubeconfig and
keeping Brain's own messages in Brain's own database needs none.

## Consequences

- The inbox's aggregation boundary is the current workspace, because the
  caller's kubeconfig reaches one namespace. Account-level platform messages
  still appear everywhere since upstream writes them to every user namespace;
  account-scoped Brain messages appear everywhere because the inbox query
  adds the person's `user_uid` rows.
- Brain-produced messages are invisible to the desktop's own inbox; the
  desktop is a later channel if ever wanted.
- Read state can diverge between Brain and the desktop for Developers (no
  patch permission) and whenever the best-effort patch fails; the receipt is
  authoritative inside Brain.
- Producers only fire where a request carries the observed data (the chat
  turn and the sidebar's quota warm-up for quota; the inbox's own credits
  read for the gift hint; the Plan view's settlement for subscription-change
  receipts). A state that changes while no
  one is using Brain is noticed on the next request, not at the moment it
  changes. The observed snapshot is the client's (the desktop SDK's quota
  read, already trusted for chat context), so a workspace member could post
  a fabricated one — the write lands only in that member's own verified
  workspace, as a nuisance entry, never across workspaces.
- Freshness is poll-bound (≤5 minutes); a WATCH upgrade is a later change to
  the proxy only.
- `sealai_notification` joins the app-owned schemas: migrations apply at
  boot, PGlite tests replay them, and receipts re-key on account merge with
  the other uid-keyed personal resources (ADR-0059).
