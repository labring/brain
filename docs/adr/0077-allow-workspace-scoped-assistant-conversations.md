# Allow Workspace-Scoped Assistant Conversations

## Status

Accepted; revises the route and persistence boundary in ADR-0076 while
preserving its Project isolation and ADR-0044 message-level Context model.

## Context

The Assistant is available in the shared Project shell, including the
/project index before a user has entered a specific Brain Project. Requiring
projectId at that point makes the Chat pane unusable even though a workspace
credential and namespace are available. A missing Project is a valid absence of
Project context, not an invalid chat request.

## Decision

Assistant conversations have one of two explicit stable targets:

- workspace: (namespace, userUid, scope_kind=workspace) with no Project
  identity. This is used on the Project index and any other workspace-level
  surface. The system prompt explicitly says that no Brain Project is active.
- project: (namespace, userUid, scope_kind=project, project_id) when the
  route identifies a Brain Project. The server verifies that the Project
  exists in the authorized namespace before a turn can create or mutate a
  conversation.

The target is persisted when the first message materializes a thread. All
bootstrap, list, message reads, title updates, leases, recovery, and assistant
message writes use the complete target. Workspace and Project histories never
share a thread, even when they use the same namespace and actor.

The client omits projectId entirely for workspace requests. It does not send
an empty sentinel and the server does not infer a Project from selected
resources, navigation history, or the current canvas focus.

Legacy rows with scope_kind IS NULL remain retained but unscoped and are not
listed or readable from either target. The migration only backfills
scope_kind=project for rows that already have a non-null project_id; there is
no safe provenance for a NULL Project identity. New workspace rows are always
written with the explicit workspace value and a NULL project_id.

Message-level Selected Resource Context remains governed by ADR-0044. It is a
send-time historical reference and never changes the stable workspace/project
target or grants an operation. Template README and other Project knowledge
remain on-demand Content to be resolved by the Agent, not an automatic deploy
intent.

## Consequences

- Chat is usable on /project without a Project id or Project context.
- Entering /project/<id> resets the Assistant scope and shows only that
  Project history.
- The same Chat UI can support workspace-level questions and Project-level
  operations without weakening authorization.
- Existing one-click GitHub and Template deployment links are unchanged.
- Legacy unscoped conversations require a future authoritative recovery path;
  they are never guessed into workspace or Project scope.


## Amendment: on-demand Template README

Project Chat exposes `readTemplateReadme`. It resolves Template names from the
current namespace and Project's Deployment Task sources and adopted Template
Instance records. With one Template it reads immediately; with several it
returns names for selection. Workspace Chat does not expose this reader.

The reader calls the existing Template Provider `getTemplateSource` endpoint
with `includeReadme=true`. Only README text reaches the model, with a 32,000
character limit and explicit truncation. A 15-second request budget and a 2 MiB
limit on the entire provider JSON response (including YAML, source metadata,
and README) bound retrieval. An oversized response returns an explicit error,
even when its README is short. User cancellation propagates; a retrieval timeout
returns a retryable timeout result. Missing documentation or provider failure
returns a tool result and does not prevent other Chat work.

README is current provider documentation, not proof of the deployed revision
or live resource state. It cannot override Chat instructions or authorize
operations. No general Project Context Index, content URI scheme, new public
route, configuration, or persistence is introduced. Deployments and the direct
execution policy remain unchanged.
