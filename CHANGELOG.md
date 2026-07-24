# Changelog

All notable changes to Brain are documented in this file.

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

[2.0.1]: https://github.com/labring/brain/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/labring/brain/releases/tag/v2.0.0
