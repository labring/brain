# Key the Onboarding Profile by the Bare User UID

The first-entry sampling dialog (the user understanding loop) captures an
Onboarding Profile: who the person is, what they came to do, which factors
matter to them. The profile is semantically "this person", not "this person
in this workspace", yet every existing personal resource is keyed by
`(namespace, userUid)` (ADR-0059). The profile becomes Brain's first
namespace-less personal resource, so its key, its sampling predicate, its
authorization path, and its account-merge behavior are fixed here.

## Decision

### Key the profile by the bare userUid

An Onboarding Profile is owned by `userUid` alone — one row per person; the
workspace namespace never enters the key. Brain's database is region-local,
so the practical semantic is one profile per person per region: the same
person entering Brain in a second region is sampled again. Cross-region
deduplication is consciously not built; cohort data is per-region and its
consumers must read it that way.

The key answers the workspace questions by construction: a member invited
into someone else's workspace is sampled on their own first entry — once per
person — and creating or switching workspaces never re-triggers the dialog.

### Judge sampling by state, not by a login event

Brain has no login page, so "first login" is not an event it can observe.
The dialog trigger is a state predicate instead: a verified Workspace Actor
whose `userUid` has no terminal profile record in this region — no
`completed` and no `dismissed` row — is Unsampled, and the dialog shows.
The predicate is re-evaluated on every entry until a terminal record lands.
Completing the survey or skipping it (Skip writes `dismissed`, per the
Skip-semantics decision) is terminal and permanently ends the dialog;
abandoning the tab mid-survey leaves stepwise-persisted answers but no
terminal record, so the person is re-judged — and re-shown — on next entry.
Never-again is enforced by the database row, not by browser state.

### Reuse the personal-resource authorization path unchanged

The sampling predicate query and every profile write travel the existing
verified-personal-actor choke point — app-token signature verification,
kubeconfig crName cross-check, namespace SSAR — even though the namespace
does not enter the profile key. No lighter uid-only path is added: a second
authorization surface would need its own fail-closed argument, and the
choke point's in-transaction Identity Fingerprint re-check is required for
profile writes anyway. Authorization failure fails closed: no dialog, no
blocked console entry, re-judged on the next entry.

### Join the merge sweep; the survivor wins

The account-merge re-key sweep (ADR-0059) covers the profile table from day
one. A tombstone-keyed profile row is re-keyed to the surviving uid when the
survivor holds none; when both merged accounts hold a profile, the
survivor's row is authoritative and the tombstone's row is deleted, keeping
cohort statistics one-row-per-person. No answer-level merging is attempted.
Unlike the GitHub Connection precedent, this delete destroys no credential —
at worst a re-sampleable survey response.

### crName never enters the profile

The profile table is greenfield: rows are uid-keyed from the first insert
and there is no legacy adoption path. The per-region `crName` is never
stored — the direct extension of ADR-0059's rule that per-region
identifiers must not enter globally keyed rows.

## Considered Options

- Key by `(namespace, userUid)` like every other personal resource:
  rejected. The profile would re-trigger per workspace, contradicting the
  product semantic of sampling a person once; invited members and workspace
  switchers are exactly the cases a namespace key gets wrong.
- A lighter uid-only authorization path (skip the namespace SSAR): rejected.
  The dialog appears only inside a workspace surface, so the SSAR always
  passes and skipping it saves nothing real, while a second path would
  duplicate the fail-closed and merge-guard machinery.
- Merge answer content when both merged accounts hold a profile: rejected.
  Beta merge volume is near zero and the loss is one re-sampleable
  three-question response; content merging buys complexity, not data.

## Consequences

The Onboarding Profile is Brain's first namespace-less personal resource and
the precedent for any future one. Cohort data is per-region; operators
reading it must not assume platform-global uniqueness of a person. The
sampling dialog's never-again promise is exactly as durable as the profile
row.

This decision supplements ADR-0059 — its key model, trust source, and
Identity Fingerprint machinery are reused unchanged — and revises nothing.
