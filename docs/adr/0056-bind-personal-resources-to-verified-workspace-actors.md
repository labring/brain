# Bind Personal Resources to Verified Workspace Actors

## Status

Accepted; the actor subject key, identity trust source, and migration mode are
revised by ADR-0059.

GitHub Connections and Assistant Conversations are personal resources inside a
namespace that may be shared by several members. The former APIs accepted a
Desktop user id from the client and treated namespace authorization as the only
enforced boundary. A member could therefore select another member's personal
identity while still presenting valid credentials for the shared namespace.

## Decision

### Derive the Workspace Actor from the request kubeconfig

Brain derives the Workspace Actor from the authenticated subject of the bearer
token in the request's kubeconfig. The same token is sent to the Kubernetes API
server for the existing namespace authorization check, so its authenticated
subject is trusted at the same boundary as that authorization result.

A Workspace Actor is eligible only when the subject has this shape:

```text
system:serviceaccount:user-system:<crName>
```

The actor's subject key was `crName`, the ServiceAccount name; ADR-0059 moves
it to the global `userUid`, keeping `crName` as the verified kubeconfig
identity and cross-check anchor. A kubeconfig rotation deletes and recreates
the ServiceAccount, changing its UID while preserving its name, so keying
ownership by ServiceAccount UID would silently orphan a user's personal
resources after rotation.

Namespace authorization remains a separate check. A verified Workspace Actor
without access to the requested namespace is forbidden, and access to a
namespace never permits a caller to select a different actor. An authenticated
subject that is not a `user-system` ServiceAccount may use namespace-shared
operations when authorized, but it cannot own or operate on personal resources.

The kubeconfig bearer token is distinct from the Desktop session JWT. A Desktop
session provides both a session JWT signed with a Desktop HMAC secret and a
kubeconfig whose bearer token is the member's Kubernetes ServiceAccount token.
Brain trusts only the latter for this decision. In a shared workspace, a
RoleBinding binds each member's own `user-system/<crName>` ServiceAccount into
the workspace namespace; switching workspaces rewrites only the kubeconfig
context namespace and leaves that member's bearer token unchanged. Members in
one namespace consequently remain distinguishable by authenticated subject.

### Enforce personal ownership

A GitHub Connection is owned by `(namespace, Workspace Actor, identity
generation)`. Status, repository listing, token use, reauthorization, and
disconnect all resolve the owner from the verified Workspace Actor; a
client-supplied Desktop user id or connection id cannot select the owner.

An Assistant Conversation is owned by `(namespace, Workspace Actor)`. Ownership
is set at creation and is immutable. List, bootstrap, read, append, continue,
and title operations enforce that owner: on those paths a conversation owned by
another actor is indistinguishable from a missing conversation. First-message
creation refuses a client-minted id another actor already owns — failing closed,
though a prober could tell that refusal apart from a fresh create; ids are
unguessable UUIDs, so an opaque chat id is still not a capability. Free Chat
Turns remain a namespace-shared allowance.

OAuth state binds the verified Workspace Actor, namespace, identity generation,
and expiry before the browser redirect. The callback atomically consumes that
state and persists the connection for its bound owner because the redirect does
not carry the request kubeconfig.

### Keep Deployment Tasks collaborative without transferring credentials

GitHub Deployment Task creation records the creating Workspace Actor and an
immutable Deployment Credential Binding: the credential owner, selected GitHub
Connection reference, and binding version. Namespace-authorized members may
continue to inspect a task, request cancellation, or submit Blocking Input.
Cancellation and Blocking Input record the Deployment Action Actor when one is
available; inspection stays a pure read (ADR 0037) and records nothing. No
shared task action changes the task's Deployment Credential Binding, so a task
may keep using member A's credential after member B supplies one.

Redeploy always creates a new task. It may copy the predecessor's source,
target, result identities, and lineage, but it must resolve a new Deployment
Credential Binding from the initiating Workspace Actor's active GitHub
Connection. It never copies the predecessor's actor, credential owner, or
connection reference. Without the initiator's active connection, no new task is
created.

User-scoped marketing attribution follows the same initiator boundary. A
redeploy by the same verified global uid may retain the predecessor's consent
provenance. A different member keeps only attribution that the unsigned
normalizer permits at workspace scope: campaign/touch context remains, while
user provenance, consent state, and click identifiers are redacted unless the
new initiator supplies a receipt bound to their uid.

### Invalidate legacy personal identity

The authorization migration clears legacy GitHub Connections, Assistant
Conversations, and pending OAuth sessions instead of guessing their verified
owners. New GitHub Connections carry the current owner identity generation;
records written with the legacy generation remain inert during a rolling
overlap. Users reauthorize GitHub and create new conversations after the
migration. This is a forward-only security change and should be deployed in a
maintenance window or with a Recreate rollout.

### Defer runtime credential materialisation

This decision changes authorization, ownership, and credential selection; it
does not change how a selected OAuth token reaches the deployment runtime. The
runner still materialises it in `GITHUB_TOKEN`, authenticated clone commands,
and the GHCR pull-secret path. Replacing that delivery with a task-scoped grant
or credential broker is explicitly deferred, so Deployment Credential Binding
must not be described as runtime credential isolation.

## Considered Options

- Verify the Desktop session JWT with a shared HMAC secret: rejected here,
  reversed by ADR-0059 on new evidence about the platform's shared-secret
  reality. It closes
  the same client-selected-identity exploit, but requires Brain to hold a
  symmetric secret capable of minting any user's identity in the region. The
  kubeconfig-derived actor uses the Kubernetes API server's existing trust root
  and requires no new identity-minting secret.
- Key the Workspace Actor by ServiceAccount UID: rejected because kubeconfig
  rotation recreates the ServiceAccount and changes its UID, which would orphan
  the user's personal resources. `crName` remains stable through the rotation.
- Treat namespace membership or opaque personal-resource ids as sufficient:
  rejected because shared-workspace collaboration does not transfer personal
  ownership, and an unguessable identifier is not an authorization decision.

## Consequences

Personal APIs fail closed when no eligible Workspace Actor can be derived.
Authentication failure, namespace denial, ineligible actor type, missing or
foreign personal resource, and missing GitHub Connection remain distinct error
conditions. Read paths never disclose whether another member's resource exists;
the accepted residual channel is conversation creation refusing an already-owned
client-minted id, harmless while ids stay unguessable.

Client fields such as `userId`, `actorUserId`, and `githubConnectionId` may be
tolerated for one compatibility release, but their values never influence the
resolved actor or credential owner. Logs, telemetry, API responses, and audit
records must not expose kubeconfig tokens, OAuth tokens, connection ciphertext,
or conversation content.

This decision revises ADR-0036's GitHub Connection owner identity and ADR-0047's
Assistant Conversation boundary, and supplements ADR-0038 with Redeploy
credential-binding semantics.
