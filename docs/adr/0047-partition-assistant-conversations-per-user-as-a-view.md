# Enforce Assistant Conversation Ownership per Workspace Actor

## Status

Accepted; the authorization boundary is revised by ADR-0056, and the owner
subject key is revised to the global userUid by ADR-0059.

Assistant chat was scoped only by namespace, so members of a shared workspace
could select and read one another's conversations. Each Assistant Conversation
is now owned by the verified Workspace Actor that creates it. Ownership is an
enforced authorization boundary in addition to namespace authorization, not a
client-selected default view. Free Chat Turns stay per-namespace.

## Considered Options

- **Client-supplied owner as a default view** — rejected because a namespace
  member can select another member's id; it neither authenticates ownership nor
  protects a conversation reached by id.
- **Namespace-only authorization** — rejected because shared-workspace access
  does not imply access to another member's personal conversation.
- **Per-user entitlement** — rejected because Free Chat Turns are a shared
  workspace grant and remain keyed to the authenticated namespace.

## Consequences

- List, bootstrap, read, append, continue, and title operations resolve the
  owner from the authenticated kubeconfig's Workspace Actor. A foreign
  conversation and a missing conversation both return not-found.
- Ownership is set at creation and immutable; continuing a conversation never
  re-keys it. An opaque `chatId` is an identifier, not a capability.
- Assistant Conversations are personal resources and may be presented as
  private to their owner. They remain distinct from namespace-shared resources
  such as Deployment Tasks and Canvas Layout.
- Legacy conversations with client-selected ownership are invalidated rather
  than mapped to a guessed Workspace Actor.
- Free Chat Turns remain a per-namespace allowance rather than a per-actor
  entitlement.
