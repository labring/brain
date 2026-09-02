# Scope Assistant Conversations to Brain Projects

The Project Assistant is rendered inside a Brain Project, but its persisted
threads were keyed only by namespace and Workspace Actor. Moving between two
Projects in the same workspace could therefore reuse the same transcript and
system-prompt identity. That makes Project context ambient UI state instead of
part of the conversation's durable identity.

## Decision

An Assistant Conversation is addressed by the stable scope
`(namespace, userUid, projectId)`. The namespace and global `userUid` continue
to come from the verified Workspace Actor boundary established by ADR-0056 and
ADR-0059. The `projectId` comes from the current Project route, is required on
every conversation read and write, and is persisted on the thread row.

Bootstrap, list, message reads, first-message materialization, title updates,
stream leases, compare-and-swap recovery, and assistant-message persistence all
use the complete scope. A `chatId` is still only an opaque identifier; knowing
one cannot cross either the actor or Project boundary.

Existing thread rows receive nullable `project_id`. Rows whose Project cannot
be proven remain `NULL`: they are retained for operational safety but are not
listed or readable from any Project. We do not infer Project ownership from
current navigation, message text, selected resources, or surviving Kubernetes
objects. A future explicit migration may recover a row only from authoritative
provenance.

Free Chat Turns remain keyed by namespace. They are a workspace allowance, not
conversation content, so Project partitioning must not duplicate or reset them.

Project scope and message-level Selected Resource Context solve different
problems. Project scope is stable conversation identity. ADR-0044's selected
resource snapshot is volatile, message-level referential context. It may help
the model understand "this service", but neither form of Context authorizes an
operation: structured domain tools still validate explicit parameters, current
state, permissions, and confirmation requirements.

## Considered Options

- **Keep conversations actor-global and replace only the system prompt on a
  Project switch.** Rejected because old messages and tool results remain from
  another Project; changing the prefix cannot repair the transcript's identity.
- **Filter threads by the selected resource.** Rejected because selection is
  message-level and may change or be absent. There is no resource-focused
  conversation mode; the Project is the stable product boundary.
- **Backfill every legacy row into the Project currently open.** Rejected because
  navigation is not provenance and could silently disclose or misattribute
  history.
- **Partition Free Chat Turns by Project.** Rejected because the entitlement is
  explicitly namespace-shared and independent of conversation storage.

## Consequences

- Switching Projects resets Assistant bootstrap and exposes only the target
  Project's threads for the verified actor.
- Every Project can have independent draft, history, title, and active stream
  state even when Projects share one Kubernetes namespace.
- Old rows with `project_id IS NULL` are intentionally invisible until an
  authoritative recovery path exists.
- The existing one-click GitHub and Template deployment paths do not change.
  Template README or runtime-contract knowledge is future on-demand Project
  Content, not an automatically emitted deploy intent.
- Selected AP, DB, and PublicAccess references stay pinned to individual user
  messages under ADR-0044 and are never promoted into an execution grant.
