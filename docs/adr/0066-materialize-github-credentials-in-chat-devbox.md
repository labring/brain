# Materialize GitHub Credentials in Chat Devbox Login Shells

Chat Devbox runtimes are long-lived and may be reused across assistant turns.
Pod environment variables cannot be changed after a runtime is created, but
the Chat Agent needs the current user's GitHub OAuth connection for `gh`, Git,
private repositories, issues, and pull requests.

## Decision

At runtime ensure-time, Brain resolves the verified global user UID's current
GitHub connection and atomically writes a single credential profile file. Login
shells source that file, export `GH_TOKEN`, and run `gh auth setup-git`. The
profile also exports `SEALAI_GITHUB_STATUS`; command output is wrapped with a
stable diagnostic for disconnected, unavailable, or rejected credentials, and
GitHub token forms are redacted from returned stdout/stderr and file reads.

Disconnecting a connection first fences the current and legacy OAuth rows, then
clears the profile file from every tracked Chat Devbox runtime for the same
namespace and user UID, and only then deletes the fenced rows. A failed cleanup
leaves the fenced rows as a durable retry ledger; the Chat Devbox lifecycle
sweep retries runtime cleanup and final deletion. A reauthorization created
after the fence is active and is not deleted by the earlier disconnect.

Identity merges re-key the runtime ledger and pending-revocation metadata along
with the OAuth connection and other UID-owned resources. Runtime lookup and
cleanup are always scoped by both namespace and global user UID.

## Boundaries

- The Chat Devbox image must provide `gh`; pinning and installing that binary is
  a separate runtime-image issue.
- Brain does not revoke the GitHub-side OAuth grant on disconnect; it forgets
  the local row and removes runtime materialization.
- Deployment-task credential delivery remains governed by the existing
  deployment ADRs; this decision covers Chat Devbox login shells only.

## Consequences

GitHub credentials exist briefly at rest inside the user's active Chat Devbox
profile file and are removed on disconnect or when the runtime disappears.
Because the runtime is reusable, ensure-time synchronization is mandatory;
because revocation and runtime operations can fail independently, fencing and
the lifecycle retry ledger are part of the authorization contract rather than
best-effort logging.
