# Changelog

All notable changes to Brain are documented in this file.

## [2.0.3] - 2026-07-29

### Added

- Added optional `DEPLOY_SKILL_SOURCE` configuration for testing another
  `sealos-deploy` source in staging while retaining the production
  `brain-deploy` source by default.

### Changed

- AI Deployment Timelines now show stable, meaningful progress messages,
  coalesce repeated updates, and retain safe resource status and timeout
  events.
- Sealos Template configuration now displays trusted canonical keys, labels,
  descriptions, choices, and non-sensitive defaults. Submitted values and
  sensitive defaults remain hidden and are never persisted.

### Fixed

- Fixed AI deployment configuration rendering generic unlabeled fields or
  treating internal blocker IDs as user-facing submission keys.
- Legacy AI tasks whose input metadata cannot be safely projected now fail
  closed into a redeployable state instead of remaining blocked indefinitely.

### Upgrade Notes

- No database migration is required. Existing installations only need to roll
  out the UI image for these changes.
- `DEPLOY_SKILL_SOURCE` is optional. Changing it requires a UI rollout and
  affects only new deployment runtimes; Devboxes where `sealos-deploy` is
  already installed are not overwritten.

## [2.0.2] - 2026-07-28

### Added

- New Projects now receive meaningful Display Names derived from their
  deployment source. Name collisions are resolved with numeric suffixes, and
  case-insensitive uniqueness is enforced by the database.
- Added an isolated worktree launcher for running multiple local development
  environments with separate ports and generated configuration.

### Changed

- VictoriaLogs credentials are now loaded from static API process environment
  variables instead of Kubernetes Secrets during each request.
- Increased Assistant reasoning effort for more reliable Project operations.

### Fixed

- Removed the 110-second Assistant stream deadline so long-running operations,
  including cold Devbox starts, can complete without being interrupted.
- Restored background Devbox warmup when opening a Project and skipped warmup
  cleanly when Devbox integration is not configured.
- Prevented stale or out-of-order deployment projection events from regressing
  task state, resurrecting purged tasks, or leaving event streams frozen after
  a failed PostgreSQL subscription.
- Fixed terminal startup when kubeconfig values contain whitespace or
  characters that require encoding before WebSocket initialization.
- Fixed AP telemetry pod matching so similarly prefixed workloads no longer
  contribute metrics to one another.
- Refused database restores that would overwrite an existing connection Secret
  not owned by the restore target.
- Fixed PostgreSQL table detection for quoted identifiers, including mixed-case
  names, spaces, and embedded quotes.

### Upgrade Notes

- `VMAUTH_SECRET_NAMESPACE` and `VMAUTH_SECRET_NAME` are no longer used. Set
  `VLSELECT_USERNAME` and `VLSELECT_PASSWORD` on the API process when
  VictoriaLogs requires authentication, then restart or roll out the API.
- The Project migration enforces case-insensitive Display Name uniqueness. If
  existing names differ only by case, the earliest Project keeps its name and
  later Projects receive the lowest available numeric suffix.

## [2.0.1] - 2026-07-24

### Added

- Added direct Template deployment from `/deploy` URLs. Valid links can prefill
  Template inputs, create a Project, and start deployment without asking the
  user to enter the same configuration again.
- Added on-demand PostgreSQL System Objects in DB Access, keeping system schemas
  and tables hidden until requested.
- Added a Chinese product operations guide covering current product behavior,
  limitations, and support workflows.

### Changed

- Database connection strings are now masked in the Canvas and Settings UI and
  fetched only when a user explicitly reveals or copies them. Regular database
  read responses no longer include decoded credentials.
- GitHub deployment tasks now use the initiating user's AI Proxy credentials
  instead of platform OpenAI credentials and fail closed when those credentials
  cannot be resolved.
- Deployment failures now expose stable, actionable reasons. Deployment
  timelines, artifacts, AI events, and Gateway updates use explicit public
  projections that omit runtime locators, secrets, and untrusted fields.
- A blocked deployment now means that explicit user input is required. Invalid
  blockers are rejected, user input is validated against the authoritative
  request, and historical invalid blocked tasks can recover as failed tasks.
- GitHub Connections and Assistant Conversations are now bound to the verified
  Workspace Actor derived from the request kubeconfig. Deployment credential
  ownership is preserved across collaborative task actions and resolved again
  for redeployments.
- New deployment Devboxes use a `10Gi` storage limit by default. Existing and
  resumed Devboxes are not resized.
- GitHub disconnect now asks for confirmation, and authorization always opens
  the GitHub account picker so users can switch accounts deliberately.
- Updated the Sealos Skills installation command to use
  `labring/sealos-skills`.
- Added repository-wide CI checks for formatting, type checking, and linting.

### Fixed

- Recovered Assistant conversations left with incomplete browser-tool results
  after reloads, disconnects, timeouts, or interrupted streams.
- Serialized Assistant turns with owner-scoped leases and guarded persistence
  so overlapping or replayed requests cannot overwrite newer conversation
  history.
- Hid the free-turn counter and showed the transition notification immediately
  when the final free Assistant turn is consumed.
- Fixed the Desktop Home action reopening Brain instead of remaining on Sealos
  Desktop.
- Fixed modal dialogs opened from a Side Pane or Session Drawer causing the
  Project Canvas to refocus unexpectedly.
- Improved public-address links, container image copy actions, Template creation
  icons, and GitHub repository list controls.
- Improved off-cluster local Kubernetes development while keeping production
  requests pinned to in-cluster API coordinates and trust roots.

### Security

- Personal GitHub and Assistant resources can no longer be selected through
  client-provided user or connection identifiers inside a shared namespace.
- Deployment data returned to the UI is scrubbed on both write and read paths;
  unknown event kinds and fields fail closed.
- Database credentials are no longer amplified through normal Canvas and
  project polling responses.

### Upgrade Notes

- The Workspace Actor migration is forward-only. It clears existing GitHub
  Connections, pending GitHub authorization sessions, and Assistant
  Conversations because their verified owners cannot be inferred safely.
  Users must reconnect GitHub and start new Assistant conversations after the
  upgrade.
- Deploy the UI with a maintenance window or a `Recreate` rollout so old and new
  authorization routes never run concurrently. The bundled Helm values now use
  `Recreate` for the UI deployment.

## [2.0.0] - 2026-07-16

Brain v2's first generally available release brought application deployment,
databases, and day-to-day operations into one Project workspace.

### Added

- Added Project creation from GitHub repositories, container images, databases,
  and application Templates.
- Added a unified deployment timeline for tracking progress, providing required
  configuration, diagnosing failures, canceling, and redeploying.
- Added application, database, and public-access management to Project Canvas.
- Added logs, metrics, terminals, and image history, together with database
  access, backup, and restore workflows.
- Added Project Assistant for understanding the current Project context and
  starting supported operations.

[2.0.3]: https://github.com/labring/brain/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/labring/brain/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/labring/brain/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/labring/brain/releases/tag/v2.0.0
