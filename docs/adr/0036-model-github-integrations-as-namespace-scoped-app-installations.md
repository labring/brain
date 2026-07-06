# Model GitHub Integrations as Namespace-Scoped App Installations

Brain's GitHub deployment path must support shared Sealos workspaces. A Sealos
namespace is the workspace and resource boundary: multiple Sealos users can work
in the same namespace, and each user has a distinct Desktop SDK `user.id`.
GitHub OAuth personal tokens do not match this collaboration model because a
personal token belongs to the user who authorized it, not to the namespace.

We model GitHub access for deployment as a namespace-scoped GitHub App
installation. The installation represents the GitHub repositories that the
Sealos namespace can deploy from. Sealos users are deployment actors inside that
namespace; the actor identity is recorded for audit and future policy checks,
but v1 does not perform a fine-grained Sealos Role/RoleBinding deployment
permission check. If a request is authenticated for the namespace, that
namespace member may use the namespace's GitHub App connection to create
Deployment Tasks.

Personal OAuth tokens must not become shared namespace credentials. A user may
initiate or install the GitHub App connection, but other namespace members do
not use that user's personal token. Runtime repository access should use a
GitHub App installation access token minted server-side for the selected
namespace connection.

## Decision

GitHub connections are namespace-scoped app installations, not per-user personal
OAuth token bindings.

The deployment model records both:

- `actorUserId`: the Sealos Desktop SDK user who created or resumed the
  Deployment Task.
- `githubConnectionId`: the namespace GitHub App connection used to access the
  repository.

The GitHub deployment source continues to own repository data under
`source.kind = "github"` as required by ADR 0023. The Deployment Task owns the
runner execution, events, artifacts, blocking inputs, and final apply. The
runner resolves the GitHub App installation access token server-side and must
not expose GitHub credentials to the browser, matching the credential isolation
posture in ADR 0013.

## Considered Options

- Keep binding GitHub credentials only by namespace: rejected because the current
  credential is a personal OAuth token. Sharing it across all namespace members
  would let user B deploy using user A's GitHub identity.
- Bind personal OAuth tokens by `namespace + userId`: acceptable as a temporary
  mitigation for personal-token semantics, but rejected as the product model
  because it prevents a team from sharing one GitHub repository connection.
- Model GitHub as a namespace-scoped GitHub App installation: accepted because
  it separates Sealos workspace membership from GitHub repository authorization.
  Namespace members can share a team connection without sharing a person's
  token.
- Add full Sealos Role/RoleBinding deploy authorization now: rejected for v1.
  The first cut treats authenticated namespace membership as sufficient to
  deploy. `actorUserId` is still recorded so a future RBAC gate can be added
  without changing the GitHub connection model.

## Consequences

The GitHub connection persistence model should move toward:

```text
github_connections
  id
  namespace
  type = github_app
  installationId
  accountLogin
  accountType
  repositorySelection
  installedByUserId
  createdAt
  updatedAt

github_connection_repositories
  connectionId
  repoId
  fullName
  private
  defaultBranch
```

Deployment Tasks should store:

```text
deploy_tasks
  actorUserId
  githubConnectionId
  source.repo
```

The API boundary should keep validating that the request belongs to the target
namespace. In v1 this namespace validation is the Sealos permission gate for
GitHub deployment. Later, the same boundary can additionally check whether
`actorUserId` has a Sealos role that allows deployment in that namespace.

Repository listing should come from the GitHub App installation's accessible
repositories, not from a personal OAuth `/user/repos` listing. The UI may still
present the same GitHub deployer flow, but its authorization state means "this
namespace has a GitHub App connection" rather than "this browser user has a
personal OAuth token."

Runner repository cloning should use a short-lived installation access token
minted server-side for `githubConnectionId`. The token may be injected into the
Deploy Devbox clone command, but it must not be persisted on the client or
returned through public APIs.

The implementation requires a GitHub App setup callback pointing to
`/api/callback/github` and these server-side environment variables:

```text
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
```

The app-owned Postgres schema is synchronized through checked-in Drizzle
migrations under `apps/ui/drizzle/` (generated with `bun run db:generate`,
applied automatically at app startup; in production a migration failure aborts
the boot). `sealai_assistant.github_connections` is part of those migrations.
Deployments that already have an old personal-token `github_connections` table
must apply the migrations or an equivalent SQL migration before enabling the
GitHub App flow.

The personal OAuth implementation is removed rather than kept as a compatibility
path. Useful product pieces remain: namespace authentication, Desktop SDK actor
identity hydration, the GitHub deployment UI, Deployment Task creation,
task-owned timelines, and runner clone/token injection. The persistence and
runtime token path are GitHub App installation only.

This decision does not change ADR 0023 or ADR 0028: all GitHub deployments still
create Deployment Tasks, and progress remains task-owned rather than
browser-only or chat-owned.
