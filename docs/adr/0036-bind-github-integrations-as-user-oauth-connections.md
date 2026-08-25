# Bind GitHub Integrations as User OAuth Connections

## Status

Accepted; owner identity and Deployment Task credential binding revised by
ADR-0056; the owner subject key and identity generation are revised by
ADR-0059.

Brain's GitHub deployment path must support repository clone and GHCR image
push from the DevBox/Kaniko runner. GitHub App installation tokens can access
GitHub REST Packages APIs with `packages: write`, but GHCR's OCI upload path
rejects those tokens for direct registry writes. A user OAuth token with
`write:packages` has been verified to push the same GHCR package successfully.

## Decision

GitHub deployment uses a per-user OAuth App connection bound by:

```text
namespace + verified Workspace Actor + owner identity generation
```

The Workspace Actor is derived from the authenticated subject of the request's
kubeconfig as defined by ADR-0056. A client-supplied Desktop user id or opaque
connection id is not a trusted owner identity.

The OAuth flow requests:

```text
repo read:packages write:packages
```

The resulting token is encrypted and stored server-side in
`sealai_assistant.github_oauth_connections`. A GitHub Deployment Task stores an
immutable Deployment Credential Binding resolved from the creating Workspace
Actor's active connection. The binding includes its credential owner,
connection reference, and version; none is selected by a client-supplied user
or connection id.

The GitHub App implementation remains in the codebase for future product
directions, but the Projects and deployment flows do not use it.

## Consequences

Repository listing uses the OAuth token against GitHub's user repository API.
Runner clone and GHCR push use the same encrypted OAuth token, resolved
server-side from the task's Deployment Credential Binding.

Personal OAuth tokens are not namespace-shared credentials. If two Sealos users
work in the same namespace, each user must authorize GitHub before deploying
from their own GitHub identity.

The required environment variables for this path are:

```text
GITHUB_OAUTH_CLIENT_ID
GITHUB_OAUTH_CLIENT_SECRET
GITHUB_USER_TOKEN_ENCRYPTION_KEY
```

GitHub App variables may remain configured, but are not required for the
current deployment path.

## Rejected Option

Using GitHub App installation tokens for DevBox/Kaniko direct GHCR push was
rejected. Installation tokens were verified to include `packages: write` and to
read the REST Packages API, but GHCR OCI blob upload returned:

```text
permission_denied: installation not allowed to Write organization package
```

GitHub Actions with `GITHUB_TOKEN` remains a possible future direction, but it
requires a larger build execution redesign and is not the current launch path.
