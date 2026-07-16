# ADR Index

One line per decision; the linked record is authoritative. When adding an ADR, take the next unused number and append it here.

- [0001 — Persist Project Canvas Layouts in App Postgres](0001-persist-project-canvas-layouts-in-app-postgres.md)
- [0002 — Model Project DB References as AP Environment Variables](0002-model-project-db-references-as-ap-environment-variables.md) *(editor model revised by ADR-0018)*
- [0003 — Derive Canvas Connections from Resource State](0003-derive-canvas-connections-from-resource-state.md)
- [0008 — Model AP Elastic Scaling as a replica strategy](0008-model-ap-elastic-scaling-as-replica-strategy.md)
- [0009 — Promote Platform Addresses as Custom Domain CNAME targets](0009-promote-platform-addresses-as-custom-domain-cname-targets.md)
- [0013 — DB Terminal runs the native engine client via pod-exec with server-side credential injection](0013-db-terminal-pod-exec-native-client-server-side-credentials.md)
- [0014 — Orchestrate Project Surfaces Separately from Canvas Selection](0014-orchestrate-project-surfaces-separately-from-canvas-selection.md)
- [0015 — Remove Public Project Preview Sharing](0015-remove-public-project-preview-sharing.md)
- [0016 — Model App Listening Ports as Private Addresses](0016-model-app-listening-ports-as-private-addresses.md)
- [0018 — Model AP Environment as Raw Source and Compiled Runtime Env](0018-model-ap-environment-as-raw-source-and-compiled-runtime-env.md)
- [0019 — Model Project Settings as Provider-Defined Side Pane Views](0019-model-project-settings-as-provider-defined-side-pane-views.md)
- [0020 — Keep Shared UI Free of Product Workflows](0020-keep-shared-ui-free-of-product-workflows.md)
- [0021 — Persist First Incremental Canvas Placements](0021-persist-first-incremental-canvas-placements.md)
- [0022 — Use Row-Major Global Canvas Placement](0022-use-row-major-global-canvas-placement.md)
- [0023 — Model All Deployments as Deployment Tasks](0023-model-all-deployments-as-deployment-tasks.md)
- [0024 — Model Canvas Placement Owners for Deployment Projections](0024-model-canvas-placement-owners-for-deployment-projections.md)
- [0025 — Stream Project Deployment Task Projections](0025-stream-project-deployment-task-projections.md)
- [0026 — Detect Settings Draft Conflicts at Submit Time](0026-detect-settings-draft-conflicts-at-submit-time.md)
- [0027 — Use Sealos Native Product Labels for Template Instances](0027-use-sealos-native-product-labels-for-template-instances.md) *(replaces the earlier deployment-scoped Brain label model)*
- [0028 — Model Deployment Progress as Task-Owned Timelines](0028-model-deployment-progress-as-task-owned-timelines.md)
- [0029 — Let Project Runtime Own Resource Read-Side Facts](0029-let-project-runtime-own-resource-read-side-facts.md)
- [0030 — Store Pending Settings Updates Browser-Locally](0030-store-pending-settings-updates-browser-locally.md)
- [0031 — Own Settings Submissions at the Settings Layer](0031-own-settings-submissions-at-the-settings-layer.md)
- [0032 — Vendor a Kubernetes quantity port for client-side storage sizing](0032-vendor-kubernetes-quantity-for-client-storage-sizing.md)
- [0033 — Surface assistant billing as a free-allowance counter plus a one-time crossing notice](0033-surface-assistant-billing-as-free-allowance-only.md)
- [0034 — Anchor Log Windows as Live or Frozen](0034-anchor-log-windows-as-live-or-frozen.md)
- [0035 — Render Project Canvas from Canvas Runtime Stores and Stable Commands](0035-render-project-canvas-from-canvas-runtime-stores.md)
- [0036 — Bind GitHub Integrations as User OAuth Connections](0036-bind-github-integrations-as-user-oauth-connections.md)
- [0037 — Execute Deployment Tasks Under Leases and Guarded Transitions](0037-execute-deployment-tasks-under-leases-and-guarded-transitions.md)
- [0038 — Model Deployment Task Lifecycle Actions as Cancel, Redeploy, and Retention](0038-model-deployment-lifecycle-actions-as-cancel-redeploy-retention.md)
- [0039 — Regenerate Whole-Canvas Auto Layout as a Clustered Row-Major Grid](0039-regenerate-auto-layout-as-clustered-row-major-grid.md) *(generalizes ADR-0022's placement group to clusters; 0022 stays authoritative for incremental placement)*
- [0040 — Size Canvas Placement Footprints from the Measured Render](0040-size-placement-footprints-from-measured-render.md)
- [0041 — Preserve Canvas Node Identity by Comparing Node Data by Value](0041-preserve-canvas-node-identity-by-value.md)
- [0042 — Surface Deployment Failure Reasons Behind a Per-Runner Scrub Gate](0042-surface-scrubbed-deployment-failure-reasons.md)
- [0043 — Coalesce Deployment Stream Updates into Throttled React Commits](0043-coalesce-deployment-stream-updates.md)
- [0044 — Pin Chat Context to Each User Message](0044-pin-chat-context-to-each-user-message.md)
- [0047 — Partition Assistant Conversations Per User as a View, Not a Security Boundary](0047-partition-assistant-conversations-per-user-as-a-view.md)
- [0048 — Side Panes Animate as Overlays; Layout Width Snaps Once](0048-side-panes-animate-as-overlays-layout-width-snaps-once.md)
- [0049 — Scope DB Access View State to Each Session](0049-scope-db-access-view-state-to-each-session.md)
- [0050 — Snapshot Glass: Replace the Live Backdrop-Filter Sheet with a Pre-Blurred Texture](0050-snapshot-glass-pre-blurred-backdrop-texture.md)
- [0051 — Express Workbench Orchestration as Pure Transitions](0051-express-workbench-orchestration-as-pure-transitions.md)
- [0052 — Use In-Cluster Kubernetes Transport in Pods and Kubeconfig Transport Off-Cluster](0052-use-kubeconfig-transport-off-cluster.md)
- [0052 — Serve DB connection strings as credential-free templates with explicit reveal](0052-serve-db-connection-strings-as-credential-free-templates.md)
- [0053 — Reveal DB Access System Objects Only on Request](0053-reveal-db-access-system-objects-only-on-request.md)

## Conventions

- An ADR without a `Status` section is accepted as written.
- When a later ADR revises or replaces part of an earlier one, give the earlier ADR a `Status` section naming the reviser (see ADR 0002), and trim the superseded text instead of leaving it to mislead.
- Gaps in the sequence (0004–0007, 0010–0012, 0017, 0045–0046) are ADRs deleted because their decisions were superseded, merged, or withdrawn before release. 0017's decision (DB Service Restore creates a new DB Service) lives on as the CONTEXT.md definition.
