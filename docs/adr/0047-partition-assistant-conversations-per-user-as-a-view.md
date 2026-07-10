# Partition assistant conversations per user as a view, not a security boundary

Assistant chat was scoped only by namespace, so members of a shared workspace saw one another's conversations. We now tag each Assistant Conversation with the id of the Sealos user who created it (`session.user.id`) and list each user only their own — but this is a **default-view partition, not a security boundary**: the owner id is client-supplied, is not server-authenticated, and namespace RBAC remains the only enforced access control. Free Chat Turns stay per-namespace.

## Considered Options

- **Real per-user isolation** (authenticate identity via `SelfSubjectReview` → `userInfo`) — rejected: disproportionate for a semi-trusted-teammate threat model, adds a Kubernetes round-trip per request, and co-members already hold namespace RBAC (they can read the namespace's real secrets, pods, and logs directly), so the marginal protection is only over *pasted external secrets* and *the user's own questions*.
- **Status-quo namespace grain** — rejected: users reasonably expect "my conversation with the assistant" to be private by default.
- **Per-user entitlement** — rejected: an unauthenticated owner id is farmable (a fresh random id yields fresh free turns; sock-puppet members yield an N× grant), so a spendable resource must stay keyed on the authenticated namespace.

## Consequences

- The UI must **not over-promise confidentiality** — no "private" or "only you can see this" language. A determined co-member can still read a conversation by supplying another user's id; presenting it as private would lull users into pasting secrets into a spoofable store ("false privacy").
- `assistant_chats` gains a non-null owner column; the thread list filters `owner = me`; an empty owner is the dev / no-identity bucket. No data migration — the product has not launched.
- Ownership is set at creation and immutable; continuing a conversation never re-keys it. A shared thread is not offered now, but the owner-tag model leaves room to add one later (a shared sentinel or an ACL).
- By-`chatId` fetches stay namespace-gated only (a `chatId` is an unguessable capability); only the thread *list* is owner-scoped.
