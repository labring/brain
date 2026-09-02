# Changelog

All notable changes to Brain are documented in this file.

## [2.0.10] - 2026-08-31

### Changed

- Made the App Sidebar default to Collapsed on first visit. An explicit
  expand or collapse is still remembered per browser and wins over the
  default; the persistence cookie moved to `sidebar_state_v2`, resetting
  every previously remembered state once.
- Renamed the Chat Agent model override from `CODEX_GATEWAY_MODEL` to
  `ASSISTANT_GATEWAY_MODEL`. `CODEX_GATEWAY_MODEL` remains only as an internal
  variable inside GitHub Deployment Task Devboxes.

### Fixed

- Narrowed Account Debt to pay-as-you-go workspaces and skipped never-billed
  accounts, so a subscribed workspace with a zero balance no longer sees the
  "Pay-as-you-go workspaces are suspended" Status Hint or the pre-deploy
  wall. The Billing Plan balance now turns red only below zero.

## [2.0.9] - 2026-08-28

### Added

- Added billing interruption scenes: deploy failure billing forms and a
  paid-chat wall. Deployments that die on a money or quota wall now report a
  curated `balance-exhausted` reason with structured Billing Evidence, and
  the GitHub/Docker/Database/Template panes plus the assistant's deploy tool
  refuse with the same pre-deploy wall. Chat turns now judge a paid source
  server-side and refuse an exhausted source with 402 rather than mutating
  state.
- Added a dual-stream Notification Center with a Status Hint banner. A Go
  read proxy merges upstream Notification CRs with the Brain store, per-user
  read receipts, a Brain-voiced override table for the debt-ladder, a
  gift-only filter, and gift-observation plus subscription-change producers.
- Surfaced usable gift credit in the Plan Account Balance block, proxied via
  `/api/billing/credits` and degrading quietly when unavailable.

### Changed

- Gave GitHub Deploy its own `GITHUB_DEPLOY_MODEL` so the assistant model no
  longer cascades into deploy sessions.

### Fixed

- Corrected the Devbox Skill discovery shell loop.
- Made Sealos skill installation source-driven so configured sources provide
  their own skill sets and stale managed skills are cleared before reinstall.
- Aligned the account popover columns and anchored it to the rail button.

## [2.0.8] - 2026-08-27

### Added

- Added a Project list Dev Mock with a count slider for designing the project
  index and App Sidebar against any list size.
- Injected Sealos skills into Brain and installed them in the Chat Devbox.
- Routed chat deploy intent through the curated template catalog and unblocked
  GitHub deployment from chat without a Deployment Credential Binding.
- Injected workspace resource quota context into assistant turns.
- Added meaningful Resource Display Names for child resources via the ADR 0062
  resolution chain, and carried the `brain.io/display-name` annotation through
  the AP and DB product APIs.
- Deep-linked the blocked card's upgrade CTA to the Plan Picker and unified the
  free allowance label on "Free trial messages".
- Gave an expired Free plan a "resubscribe" recovery voice instead of "renew".

### Changed

- Folded menu rows into the account popover and unified sidebar icon blue
  states.
- Made the App Sidebar collapsible with Expanded and Collapsed states, a
  width-driven transition, and a 365-day persistence cookie.

### Fixed

- Used a shared model for thread titles.
- Respected managed gateway turn outcomes and preserved gateway turn failure
  reasons.

## [2.0.7] - 2026-08-21

### Added

- Added the billing cost center covering plan, usage, invoices, and AI
  credits.
- Gated free chat turns on the active free trial and blocked on exhaustion.
- Captured consent-safe marketing lifecycle attribution.
- Added a GitHub repo deep-link with auto-deploy, and let GitHub Deploy
  override user AI Proxy credentials via `GITHUB_DEPLOY_OPENAI_*`.
- Added `APP_POSTGRES_SKIP_MIGRATIONS` to skip boot-time UI database
  migrations.
- Made the GitHub callback origin runtime-configurable via `APP_URL`.
- Honored `CODEX_GATEWAY_MODEL` for GitHub deploy sessions.
- Moved AP image updates onto the settings lifecycle and added a Docker env
  raw source.
- Threaded demo build flags through the UI image build.

### Changed

- Rebuilt the dev tweaks panel as a standalone `@workspace/dev-tweaks`
  package on a DialKit fork, reskinned it on glass, contained frame mode in
  `<body>`, and stopped pinning its capsule in demo builds.
- Hardened the administrative Devbox cleanup script's namespace scoping.

### Fixed

- Projected one observed public address per ingress host for APs.
- Showed the pod workspace quota in the UI.
- Restored the invoice notice hierarchy and moved external billing CTAs to
  `AppButton`.

### Upgrade Notes

- Run UI database migration `0014`.
- Configure `MARKETING_EVENTS_INGEST_SECRET` and
  `MARKETING_CONSENT_SIGNING_KEY` when enabling marketing lifecycle
  attribution.
- New optional environment variables: `APP_POSTGRES_SKIP_MIGRATIONS` (skip
  boot-time UI migrations), `APP_URL` (GitHub callback origin),
  `CODEX_GATEWAY_MODEL` (model override for GitHub deploy sessions), and
  `GITHUB_DEPLOY_OPENAI_API_KEY` / `GITHUB_DEPLOY_OPENAI_BASE_URL`
  (dedicated OpenAI-compatible endpoint for GitHub Deploy).

## [2.0.6] - 2026-08-13

### Changed

- Removed unused dependencies and dead React Scan wiring across the workspace.
- Moved the remaining formatting path to Biome and tidied Go module dependencies.
- Added an agent-managed GitHub deployment loop in which the deployment Agent
  owns build, apply, repair, and verification while Brain remains the task
  control plane and final gate.
- Added the deployment Agent MCP control plane with durable leased tool calls,
  bounded repair handling, managed-file contracts, mutation audit metadata, and
  independent workload and public URL verification.

### Security

- Removed public operational guidance and production snapshots that exposed
  actionable internal details while retaining safe rollback guidance.

### Upgrade Notes

- Run UI database migration `0013`.
- Configure `DEPLOY_AGENT_MCP_URL` when enabling agent-managed deployments.
- Roll out the API and UI images together; the deployment Agent flow depends on
  the matching UI MCP route and task runner contract.

## [2.0.5] - 2026-08-12

### Added

- Added the complete onboarding survey, including stepwise persistence,
  terminal completion or dismissal, privacy-safe funnel events, and a
  development preview-step control.
- Added an administrative Devbox cleanup script and automatic deletion of
  paused runtimes after 24 hours, with bounded, retryable cleanup claims.
- Added process-level Kubernetes discovery caching and concurrent credential
  lookups to reduce repeated API discovery and connection-string latency.

### Changed

- Reworked the onboarding dialog layout and selection states for stable frame
  height, responsive copy, keyboard focus, scrolling, and accessible validation.
- Shared personal-resource authorization and HTTP error handling across
  onboarding, Assistant, and GitHub connection routes.
- Upgraded shared API schemas to Zod 4 and tightened React Hooks lint
  compatibility.

### Fixed

- Made Project deletion previews server-authoritative and ordered approval
  actions correctly.
- Added busy and error feedback for secret reveal and copy controls, reusing an
  active reveal without issuing a second request.
- Prevented terminal onboarding writes from racing or losing confirmed answers.

### Upgrade Notes

- Run UI database migrations `0011` and `0012`.

## [2.0.4] - 2026-08-04

### Added

- Added guarded Project management tools to Assistant for listing, reading, previewing
  deletion, and deleting Projects. Deletion requires user approval and records an audit
  event.
- Added Brain GTM tracking for module views, deployment creation and start, deployment
  deletion, and resource-card actions. Tracking can be enabled with `GTM_ID`.
- Moved the deployment task Dock into the top bar and folded it into an overflow menu
  based on the available width.
- Added a pinned Side Pane footer so deployment submission, settings saves, and deployment
  task lifecycle actions remain visible.

### Changed

- Personal resources now use the global `userUid` as their ownership key across GitHub
  Connections and Assistant Conversations. Existing data is adopted on first access, with
  identity fingerprints and account-merge handling.
- Added a timeout policy for deployment tasks, producing explicit and recoverable failure
  states when a task exceeds its limit.
- Template deployment now supports richer parameter controls and choices while preserving
  entered parameters after catalog refreshes, the original template YAML, and Sealos
  Template DSL.
- Added `DEPLOY_SKILL_SOURCE` configuration for selecting the deployment Skill branch or
  source.
- Reworked elastic-scaling controls around target metrics and toggle interactions, and
  improved feedback and visual hierarchy across project creation, project list, log viewer,
  and resource settings surfaces.

### Fixed

- Restored the Project deletion confirmation flow with complete previews, target checks, and
  rejection of expired or tampered deletion requests.
- Fixed sensitive-field handling, Template declaration state, and resource identity
  consistency during resumable template deployments.
- Fixed React Compiler compatibility issues in the Side Pane and top-bar slots.
- Fixed icon-button hover colors being triggered by Tooltip state, and aligned the log live
  control size and project-list pin-button hover styling.

### Upgrade Notes

- Run UI database migrations `0008`, `0009`, and `0010`.
- Production UI deployments must configure `JWT_INTERNAL` to the cluster-shared app-token
  signing secret used by Sealos Desktop. The service refuses to start when it is missing.
- Ensure Sealos Desktop provides an app token for requests. Missing, invalid, or
  account-merge-superseded tokens cannot access Assistant, GitHub Connections, or GitHub-
  source deployment operations.
- `GTM_ID` is optional. No GTM events are sent when it is unset.
- Existing GitHub Connections and Assistant Conversations are adopted automatically on first
  access; no manual data migration is required.

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

### Removed

- Removed the outdated Chinese product operations guide.

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

[2.0.10]: https://github.com/labring/brain/compare/v2.0.9...v2.0.10
[2.0.9]: https://github.com/labring/brain/compare/v2.0.8...v2.0.9
[2.0.8]: https://github.com/labring/brain/compare/v2.0.7...v2.0.8
[2.0.7]: https://github.com/labring/brain/compare/v2.0.6...v2.0.7
[2.0.6]: https://github.com/labring/brain/compare/v2.0.5...v2.0.6
[2.0.5]: https://github.com/labring/brain/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/labring/brain/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/labring/brain/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/labring/brain/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/labring/brain/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/labring/brain/releases/tag/v2.0.0
