# Store Cancellation Survey Responses in Brain Postgres as Feedback, Not Billing State

The Plan view's cancel dialog grows a Cancellation Survey: the user picks
which Cancellation Reasons apply and may add free text before cancelling a
paid Workspace Subscription. The answers have to land somewhere. Workspace
Subscriptions are owned by account-service, whose cancel operation accepts
no reason or feedback field, and CONTEXT.md holds that Brain stores no
billing state of its own — so the natural home of "why did this workspace
cancel" is not obvious, and a future reader will ask why Brain keeps it.

## Decision

### Brain's own Postgres is the record; account-service is never asked to hold it

A Cancellation Survey response is stored in Brain's app Postgres, in its own
schema alongside the onboarding and notification schemas, one row per
submitted survey: the workspace, its Billing Region domain, the plan name,
the current period end, the acting `userUid`, the selected Cancellation
Reason keys, the free text, and a timestamp. It is feedback *about* a
billing action, in the same class as the Notification Center's
subscription-change receipt (ADR-0067): a record that the user said
something at the moment of an event, never an authority on the
subscription's state. The Workspace Subscription's lifecycle continues to
come from account-service alone; no code path reads the survey table to
decide anything about billing.

### Reasons are stable keys; the wording is presentation

Each Cancellation Reason is persisted as a fixed machine key (for example
`too_expensive`), never as its displayed English text, so copy can change
and the historical distribution stays comparable. The key list is a closed
enum shared by the client, the server's request schema, and the analytics
event type.

### Analytics carries the keys, never the text

The GTM funnel events (`subscription_cancel` after a successful cancel with
the reason keys and a `has_feedback` flag, `subscription_cancel_kept` when
the user keeps the plan) never include the free text. Free text may contain
an email address or a company name; it stays in Postgres only, behind the
verified-actor authorization path every Brain write already uses.

### The survey is best-effort and follows the cancel

The cancel request goes to account-service first. Only after it succeeds
does the client submit the survey; a survey write failure is logged
server-side and never surfaced, so the user is never told a cancellation
failed because a questionnaire did. The reverse order is rejected: a row
recorded before a cancel that then fails would be a phantom cancellation in
the data.

## Considered Options

- Extend account-service's cancel operation with reason fields: rejected
  for now. It couples a UI questionnaire to the platform's billing API,
  needs a cross-team change to ship a survey, and would still leave the
  free text in a service whose job is money. Nothing prevents forwarding
  the keys later if the platform wants them.
- Analytics only (GTM event, no table): rejected. GTM cannot hold the free
  text safely, retention and querying are outside the team's control, and
  a reason distribution with no join to workspace or plan cannot answer
  "which plan's users cite cost".
- Reuse the notification receipt row and hang the answers on it: rejected.
  The receipt is an inbox message with a 365-day retention sweep and a
  message schema; feedback would either be pruned with it or distort it.

## Consequences

Brain now holds a table whose rows describe why paid subscriptions ended.
It is region-local like the rest of Brain's Postgres, so an account-wide
view must read every region. V1 ships no reader: the team queries it by
SQL until volume justifies a surface. No retention sweep is defined at
first; if one is added it must consider that rows contain user-written
text.

CONTEXT.md's "stores no billing state" sentence is qualified accordingly:
what a user says about a billing action is feedback, not the fact, and may
live in Brain's store. This decision supplements ADR-0067's precedent and
revises nothing.
