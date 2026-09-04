# Conclude Deployment Tasks with an Evidence-Gated Success Record

## Status

Accepted. The address model and success-copy rules are revised by ADR-0079.

## Context

ADR-0028 models deployment *progress* as a task-owned timeline, and ADR-0042
explains deployment *failure* inside that same pane. The end state had no
equivalent: a task flipping to `completed` rendered as one more ticked step,
so the first successful deployment left the user staring at a green checklist
with no answer to the only question that matters at that moment — "is it up,
and what do I do now?" (sealos-private #160).

Two placements were on the table: tell the user in the Assistant chat on the
right, or conclude inside the Timeline itself. Two hazards came with it. The
runner already announced success from whatever its artifact summary happened to
list, which for a task with no required result resource meant claiming usable
nothing; and confetti fired from render, so it replayed on every stream tick,
remount, and refresh onto a finished task.

## Decision

The conclusion lives in the Deployment Task Timeline as a Deployment Task
Success Record appended to the task-owned snapshot, and it is gated by
evidence rather than by status:

- The record is derived by reading the Timeline snapshot back, not from the
  runner's own resource list. The verification count is exactly the required
  Deployment Result Resource Cards the user can see running, so a workload
  that is ready while its entry probe is still pending publishes no claim.
- A task with no required result resource publishes no record at all. Absence
  of evidence reads as progress, never as success.
- The record carries only declared facts: product name, entry addresses, and
  first-use guidance from the product contract. The UI never derives an
  address from a host and a port, and never writes a step the contract did
  not declare.
- Public entry points use the source-independent Access Endpoint contract in
  ADR-0079. This record contains only endpoints that completed that contract's
  source observation, tenant-boundary validation, and protocol probe.
- Deterministic and Agent-managed runners share the same raw Kubernetes
  readiness predicate for a given Kind. A non-suspended CronJob is a valid
  runtime result without waiting for its next scheduled execution. Agent
  completion still needs at least one ready runtime result or one responding
  public entry; support resources alone are not completion evidence.
- Readiness and Agent verification/repair each receive a 30-minute aggregate
  convergence window. Individual HTTP requests remain capped at 15 seconds,
  and individual Agent control checks remain bounded below the MCP route's
  60-second request duration.
- Re-attaching an identical conclusion is a no-op: it does not bump the
  Timeline revision, so the conclusion is stable across reconnects.
- A Deployment Celebration owns the one-shot announcement, claimed by
  task-plus-revision and held in a store outside React; it requires a
  transition observed while mounted, so entering an already-successful task
  shows the record without a party. The celebration window ends only the
  confetti; the Timeline stays open with the result visible until the user
  closes it.

## Considered Options

- Post the success message in the Assistant chat and keep the Timeline as a
  progress log: rejected. The chat is a conversation surface, and a deployment
  that succeeded while the user was typing has nothing to say; it also splits
  one outcome across two places the user must reconcile.
- Announce from `status === "completed"`: rejected. Completed is runner
  bookkeeping; usability is what the required resources and their probes
  prove. The pane still requires it, so the two gates must both hold.
- Fire confetti from an effect watching the success flag: rejected. Every
  re-render path of a live surface becomes a replay.

## Consequences

- `DeploymentTaskTimelineSnapshot.success` is a versioned contract field, and
  the Timeline drops anything undisplayable when a record is attached rather
  than rendering it unverified.
- First-use guidance can only appear once a product contract actually declares
  it. Until the template contract carries those steps, the record shows what
  it can prove — the verified resources and any declared address. Template
  Ingress hosts therefore appear as clickable Public Domain entries after
  their probes pass.
- Any surface that renders a Timeline renders its conclusion; there is no
  second success channel to keep in sync.
