# Forget GitHub Connections Locally on Disconnect

A GitHub Connection stores one OAuth token per namespace and verified Workspace
Actor (ADR-0036, ADR-0056), but GitHub's underlying OAuth grant is scoped to
the whole GitHub account × OAuth App pair. Disconnect semantics toward GitHub
were never decided; the implementation happened to forget locally.

## Decision

Disconnecting a GitHub Connection deletes only Brain's stored connection row.
Brain never calls GitHub's revocation endpoints on disconnect. A user who wants
the GitHub-side authorization gone revokes it from GitHub's own settings page.

Account choice and switching are connect-time concerns, not disconnect-time
concerns: the OAuth authorize URL always sends `prompt=select_account`, so
GitHub shows its account picker instead of silently completing with the current
github.com session (re-authorizing an already-authorized OAuth App otherwise
skips the consent screen entirely). Switching accounts means authorizing again
as the other account, which overwrites only the current namespace-and-actor
connection row.

## Considered Options

- **Revoke the grant on disconnect** (`DELETE /applications/{client_id}/grant`)
  — rejected outright. GitHub deletes every token for that account × app,
  which silently breaks the same person's live connections in other
  namespaces and violates the per-actor isolation of ADR-0056. The grant is
  account-global; our connections are not.
- **Revoke the single token on disconnect** (`DELETE …/token`) — rejected as
  unnecessary. It adds a GitHub API dependency and failure mode to disconnect
  while GitHub already bounds orphaned tokens (auto-revoked after one year of
  non-use, at most ten tokens per user × app × scope). No surveyed vendor
  documents doing it either; local-forget is the industry norm.

Survey and primary sources:
[docs/research/github-oauth-disconnect-and-account-switching.md](../research/github-oauth-disconnect-and-account-switching.md).
