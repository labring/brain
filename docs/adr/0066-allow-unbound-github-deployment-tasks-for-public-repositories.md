# Allow Unbound GitHub Deployment Tasks for Public Repositories

## Status

Accepted; amends the credential-binding requirement established by ADR-0036
and refined by ADR-0056 and ADR-0059.

ADR-0036 introduced the Deployment Credential Binding because the GitHub
runner needs a user OAuth token for two things: cloning the repository and
pushing the built image to GHCR. Both paths were treated as unconditional, so
a GitHub Deployment Task could not exist without a binding, and the Assistant
refused GitHub deployment outright.

Neither need is unconditional in practice. A public repository clones
anonymously, and the `sealos-deploy` skill's image-detection phase skips the
build entirely when the repository already publishes a container image. For
that class of deployment — which covers most self-hosted open-source
applications a user asks the Assistant to deploy — no credential is required
at any step.

Requiring a binding therefore blocked the largest, safest segment of GitHub
deployments and pushed the Assistant into guessing a Docker image instead.

## Decision

### A GitHub Deployment Task may be created without a credential binding

A GitHub task now carries an optional Deployment Credential Binding. The
runner resolves no token for an unbound task, clones anonymously, and runs
without registry credentials. A binding that is present must still be current:
a stale or superseded binding fails rather than silently downgrading to an
anonymous clone, because the initiator did connect GitHub and a revoked
connection must surface.

The verified creator is still required. Unbound only removes the credential,
never the identity of who created the task.

### Creation fast-fails a repository that is not publicly readable

Before an unbound task is created, Brain asks GitHub whether the repository is
readable. A positive refusal (`404`, or `403` with budget remaining) rejects
the request with `github_repo_private` and directs the user to connect GitHub.

The check fails open. Anonymous GitHub API reads are limited to 60/hour per
egress IP, so an exhausted budget, a network error, or an upstream failure
must not block a deployment: only GitHub positively refusing does. The
anonymous answer is cached for an hour; the authenticated path has a
5000/hour budget and is not cached.

### The managed prompt tells the agent it cannot push an image

An unbound task's gateway prompt states that no registry credential is
available, instructs the agent to prefer an existing published image, and
requires it to fail with `github-credential-required` rather than attempt a
push.

Without this, the unsupported case — a public repository that must be built
from source — would clone, build, and only fail at the push, minutes into a
run. Declaring the constraint before the skill's detection phase converts a
late, opaque failure into an early, actionable one.

## Consequences

The Assistant can create GitHub Deployment Tasks. It resolves the initiator's
binding when a connection exists and creates an unbound task when it does not,
so connecting GitHub upgrades capability rather than gating entry.

Unbound tasks support exactly one class of deployment: a public repository
that already publishes a container image. Private repositories are rejected at
creation; public repositories needing a source build fail early with
`github-credential-required`. Both messages point at the same remedy, which is
connecting GitHub in Settings.

The share of unbound tasks that end in `github-credential-required` is the
signal for whether this path carries its weight. If most requests need a
source build, the conclusion is to lower the friction of connecting GitHub
rather than to invest further in the unbound path.

## Rejected Option

Keeping GitHub deployment bound and routing the Assistant to a `prompt` source
instead was rejected. The `prompt` and `github` sources already select the
same AI runner, so the deployment would execute identically while losing the
repository, branch, and image-detection context the GitHub source carries, and
the task would be misfiled as a natural-language request in the timeline.
