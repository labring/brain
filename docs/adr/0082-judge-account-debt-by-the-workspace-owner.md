# Judge Account Debt by the Workspace Owner, Not the Workspace Actor

## Status

Accepted. Revises ADR-0068's judgment inputs (see its addendum of 2026-09-09); leaves ADR-0060's `{userUid, userId}` token claims untouched.

## Context

Every Brain read of account-service is signed with the calling Workspace Actor's own `{userUid, userId}` (ADR-0060), and Account Balance is account-scoped. ADR-0068 then judges Account Debt from that balance — the status hint banner, the Deploy Billing Notice, the Paid Chat Wall, the terminal-failure reverse check, and the assistant's deploy tool all run `accountDebtFromMoney` over the caller's account and combine it with the workspace-level fact "this workspace is Pay-As-You-Go".

The platform does not work that way. A workspace is settled against exactly one account: its Workspace Owner's. Sealos's debt pipeline finds the namespaces to suspend by the `user.sealos.io/owner` label (the owner's user CR name), marks them with the `debt.sealos/status` annotation, and its admission webhook checks the *namespace owner's* account for every request into the namespace. A member's own debt never touches a workspace they were invited into; the owner's debt suspends it for everyone. So in a shared PAYG workspace Brain voiced the wrong account in both directions — a member with an empty wallet was told the workspace was suspended and to top up, and a member with money saw nothing while the owner's debt made every deployment fail as a stall.

The workspace-level path ADR-0068 also relied on — a PAYG record the platform reports as `DEBT` through `/workspace-subscription/info` — cannot fire: for a workspace without a subscription that endpoint returns only `{"type":"PAYG"}`, no status. And account-service exposes the owner's account for a namespace only on an admin path (`/admin/v1alpha1/account-with-workspace`) that Brain-minted tokens must never reach (ADR-0060). Upstream Desktop and costcenter show the viewer's own wallet too, but they never derive debt from it; the platform's own marks carry that fact for them.

## Decision

**Account Debt inside a workspace is the Workspace Owner's fact, judged from the platform's own marks on the namespace.** Brain reads the workspace's Namespace object with the request kubeconfig and takes two things from it: the `debt.sealos/status` annotation, which is the platform's suspension verdict and holds for every Workspace Actor alike, and the `user.sealos.io/owner` label, which names the Owner.

**The balance formula runs only for the Owner.** A Workspace Actor whose verified app-token `userCrName` equals the owner label is the Owner, and for them the available-balance formula stays the early-warning path it always was (it fires before the platform's pipeline writes its mark). For anyone else the caller's balance is a different account's fact and contributes nothing: `accountDebtFromMoney` is not consulted, and no Account Balance or Gift Credit is shown in a workspace they do not own — the Billing Area's Plan view hides those blocks.

**Unknown owner means unknown debt.** When the namespace cannot be read, or carries no owner label, Brain does not know whether the caller is the Owner and therefore does not run the balance path; it voices debt only if the platform's annotation says so. This is ADR-0068's fail-open posture extended to identity: never assume the caller is the Owner.

**A member is told the truth and no dead end.** When the Owner's account is in debt, every seam speaks the same line to a non-owner — "Workspace suspended — the owner's account balance is in debt. Ask the workspace owner to top up." — with no amount, no owner name (Brain holds only a CR name), and no Top up CTA, since only the Owner can top up. The Owner keeps today's copy and CTA.

**Every seam moves together.** The client surfaces (status hint, Deploy Billing Notice, Billing Escalation, Plan view) and the server seams (Paid Chat Wall, terminal-failure reverse check, the assistant's deploy tool) share one Owner judgment, so the banner, the wall, and the failure reason can never name different accounts.

## Considered Options

- **Mint an admin token and call `/admin/v1alpha1/account-with-workspace`.** Rejected: ADR-0060 confines Brain-minted tokens to `{userUid, userId}` precisely so a leaked token can never reach an admin path; the owner's balance is also a number a member has no business seeing.
- **Ask account-service for a non-admin "owner standing for this workspace" endpoint.** Not rejected — filed as an upstream ask beside AIM-268 — but it cannot be the fix for a live bug, and the namespace annotation already states the fact the endpoint would return.
- **Gate the balance path on ownership and add nothing.** Rejected: it trades the false alarm for silence — a member in an owner-suspended workspace would see no banner, and their failed deployment would keep its stall text with no cause.
- **Derive ownership from the `ns-<crName>` naming convention.** Rejected (as in AIM-268): undocumented, and it cannot describe a shared workspace at all.
- **Wait for AIM-268 to add `role` to the PAYG subscription payload.** Rejected as the sole source: it names the caller's role but still not the Owner's debt; the namespace label is the platform's own authoritative statement of ownership and is available today.

## Consequences

- CONTEXT.md gains **Workspace Owner**; Account Balance and Account Debt are re-scoped to it, and the Workspace Actor is explicitly not the account a workspace runs on.
- Brain reads the Namespace object with the request kubeconfig for the first time. Kubernetes attributes `GET /api/v1/namespaces/<name>` to that namespace, so a Role bound there covers it: Sealos's `Developer` Role grants `get` on `*` in the namespace (`controllers/user/controllers/helper/config/rbac.go`), and impersonating a service account whose only binding is a namespaced Role gets its own namespace and is refused every other one (verified on a dev cluster). A denial on a differently configured cluster lands in the unknown-owner branch rather than an error.
- The dev fixtures gain a non-owner scenario (member of another account's PAYG workspace, owner in debt / owner fine), which nothing modeled before.
- The Billing Escalation Dialog announces the account debt ladder to the Owner alone: its rungs are the platform's notifications about the Owner's account and offer a top-up only the Owner can perform, so a member is never shown them — the status hint banner carries the member's voice. A mid-turn AI proxy balance refusal reaches the pane with the same Owner verdict, so its card asks a member instead of offering a top-up.
- Two states can disagree for the Owner alone: the balance formula may say debt before the platform's annotation appears. That is the existing early warning and stays; for members only the annotation speaks, so they may learn of the debt a reconcile later than the Owner does.
