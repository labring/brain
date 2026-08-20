# Derive Resource-Deletion Dates Client-Side from Subscription Expiry

The Billing Area's subscription warning banner states when the platform will
delete a workspace's resources ("Resources will be deleted after {date}").
The platform enforces that date in the account controller's
workspace-subscription debt pipeline: when `CurrentPeriodEndAt` passes, the
subscription enters `DEBT` and the workspace is suspended immediately; after
7 days it becomes `DEBT_PRE_DELETION`; after 14 days it becomes
`DEBT_FINAL_DELETION` and resources are deleted. Both roads into expiry — a
failed renewal payment and a cancelled subscription reaching its period end —
join the same pipeline. account-service does not expose the deletion date or
the period lengths through any endpoint Brain consumes; the subscription
object carries only the status string and the expiry timestamps.

## Decision

Brain derives the deletion date in the client's snapshot loader: deletion
date = `CurrentPeriodEndAt` (falling back to `ExpireAt`) plus a single
`RESOURCE_DELETION_GRACE_MS` constant of 14 days, mirroring the controller's
`FinalDeletionPeriodHours = 14 * 24`.

The warning surfaces carry the stage's next deadline, not one fixed date:
while a cancelled subscription is still inside its paid period, the banner
and the cancel dialog state the suspension date — `CurrentPeriodEndAt`
itself — because that is the day the workspace actually stops and the
user's real deadline to back up or renew; the derived deletion date becomes
the headline only once expiry has passed. (Revised 2026-08-17: the original
decision drove every stage, including pre-expiry cancellation, with the
derived deletion date — a date 14 days past the service cutoff, which
invited users to act only after their workspace was already suspended, and
contradicted the cancel dialog's period-end promise.)

All three `DEBT*` statuses map to the `payment-due` lifecycle — collapsing to
`active` on the unrecognized pre-deletion statuses would hide the warning in
exactly the most dangerous window — and `payment-due` outranks `cancelling`,
because a cancelled subscription that has since expired must show the
countdown, not the softer cancellation notice.

## Considered Options

- Ask account-service for a real deletion-date field and wait for it:
  rejected for now. The warning redesign should not block on an upstream API
  change; the constant is confined to one definition site and swaps out
  trivially when the field exists.
- Show no date ("resources will be deleted soon"): rejected. The date is the
  design's core motivator for backing up or renewing, and the platform's
  policy is deterministic enough to state it.
- Hardcode the copy per status instead of deriving a date: rejected. The
  status alone cannot say *when*, and the three stages would drift apart.

## Consequences

The 14-day constant is a silent cross-repo coupling: if the platform changes
`ExpiredGracePeriodHours`/`FinalDeletionPeriodHours` (hardcoded in the
account controller today), Brain's banner will state a wrong date until the
constant is updated. If account-service ever returns a deletion date or the
grace configuration, the derivation must be replaced by the upstream value
and this ADR superseded.

Because the date is derived, the banner can state a deletion date that has
already passed once `DEBT_FINAL_DELETION` begins; the "deletion-imminent"
copy ("will be permanently deleted after {date}") stays truthful across that
boundary.
