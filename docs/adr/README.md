# ADR Index

One line per decision; the linked record is authoritative. When adding an ADR, take the next unused number and append it here.

- [0001 — Persist Project Canvas Layouts in App Postgres](0001-persist-project-canvas-layouts-in-app-postgres.md)
- [0002 — Model Project DB References as AP Environment Variables](0002-model-project-db-references-as-ap-environment-variables.md) *(editor model revised by ADR-0018)*
- [0003 — Derive Canvas Connections from Resource State](0003-derive-canvas-connections-from-resource-state.md)
- [0009 — Promote Platform Addresses as Custom Domain CNAME targets](0009-promote-platform-addresses-as-custom-domain-cname-targets.md)
- [0013 — DB Terminal runs the native engine client via pod-exec with server-side credential injection](0013-db-terminal-pod-exec-native-client-server-side-credentials.md)
- [0015 — Remove Public Project Preview Sharing](0015-remove-public-project-preview-sharing.md)
- [0018 — Model AP Environment as Raw Source and Compiled Runtime Env](0018-model-ap-environment-as-raw-source-and-compiled-runtime-env.md)
- [0019 — Model Project Settings as Provider-Defined Side Pane Views](0019-model-project-settings-as-provider-defined-side-pane-views.md)
- [0023 — Model All Deployments as Deployment Tasks](0023-model-all-deployments-as-deployment-tasks.md)
- [0024 — Model Canvas Placement Owners for Deployment Projections](0024-model-canvas-placement-owners-for-deployment-projections.md)
- [0027 — Use Sealos Native Product Labels for Template Instances](0027-use-sealos-native-product-labels-for-template-instances.md) *(replaces the earlier deployment-scoped Brain label model)*
- [0028 — Model Deployment Progress as Task-Owned Timelines](0028-model-deployment-progress-as-task-owned-timelines.md)
- [0030 — Store Pending Settings Updates Browser-Locally](0030-store-pending-settings-updates-browser-locally.md)
- [0033 — Surface assistant billing as a free-allowance counter plus a one-time crossing notice](0033-surface-assistant-billing-as-free-allowance-only.md)
- [0035 — Render Project Canvas from Canvas Runtime Stores and Stable Commands](0035-render-project-canvas-from-canvas-runtime-stores.md)
- [0036 — Bind GitHub Integrations as User OAuth Connections](0036-bind-github-integrations-as-user-oauth-connections.md) *(owner identity and task credential binding revised by ADR-0056; owner key revised by ADR-0059)*
- [0037 — Execute Deployment Tasks Under Leases and Guarded Transitions](0037-execute-deployment-tasks-under-leases-and-guarded-transitions.md)
- [0038 — Model Deployment Task Lifecycle Actions as Cancel, Redeploy, and Retention](0038-model-deployment-lifecycle-actions-as-cancel-redeploy-retention.md) *(redeploy credential resolution supplemented by ADR-0056)*
- [0042 — Surface Deployment Failure Reasons Behind a Per-Runner Scrub Gate](0042-surface-scrubbed-deployment-failure-reasons.md)
- [0044 — Pin Chat Context to Each User Message](0044-pin-chat-context-to-each-user-message.md)
- [0047 — Enforce Assistant Conversation Ownership per Workspace Actor](0047-partition-assistant-conversations-per-user-as-a-view.md) *(authorization boundary revised by ADR-0056; owner key revised by ADR-0059)*
- [0050 — Snapshot Glass: Replace the Live Backdrop-Filter Sheet with a Pre-Blurred Texture](0050-snapshot-glass-pre-blurred-backdrop-texture.md)
- [0052 — Use In-Cluster Kubernetes Transport in Pods and Kubeconfig Transport Off-Cluster](0052-use-kubeconfig-transport-off-cluster.md)
- [0053 — Serve DB connection strings as credential-free templates with explicit reveal](0053-serve-db-connection-strings-as-credential-free-templates.md)
- [0054 — Reveal DB Access System Objects Only on Request](0054-reveal-db-access-system-objects-only-on-request.md)
- [0055 — Mask DB Connection Rows Behind One Shared Reveal Interaction](0055-mask-db-connection-rows-behind-shared-reveal.md) *(revises the display layer of ADR-0053; the API contract stands)*
- [0056 — Bind Personal Resources to Verified Workspace Actors](0056-bind-personal-resources-to-verified-workspace-actors.md) *(revises ADR-0036 and ADR-0047; supplements ADR-0038; subject key, trust source, and migration mode revised by ADR-0059)*
- [0057 — Forget GitHub Connections Locally on Disconnect](0057-forget-github-connections-locally-on-disconnect.md)
- [0058 — Derive Project Display Names from Deployment Sources at Creation](0058-derive-project-display-names-from-deployment-sources.md)
- [0059 — Key Personal Resources by the Global User UID](0059-key-personal-resources-by-global-user-uid.md) *(revises ADR-0036, ADR-0047, and ADR-0056)*
- [0060 — Call account-service with Self-Signed Internal JWTs](0060-call-account-service-with-self-signed-internal-jwts.md)
- [0061 — Key the Onboarding Profile by the Bare User UID](0061-key-the-onboarding-profile-by-bare-user-uid.md) *(supplements ADR-0059)*
- [0063 — Derive Resource-Deletion Dates Client-Side from Subscription Expiry](0063-derive-resource-deletion-dates-client-side.md)
- [0064 — Pin the Current Billing Region by Deployment-Declared Domain](0064-pin-the-current-billing-region-by-deployment-declared-domain.md)

## Conventions

- An ADR without a `Status` section is accepted as written.
- When a later ADR revises or replaces part of an earlier one, give the earlier ADR a `Status` section naming the reviser (see ADR 0002), and trim the superseded text instead of leaving it to mislead.
- Gaps in the sequence (0004–0008, 0010–0012, 0014, 0016–0017, 0020–0022, 0025–0026, 0029, 0031–0032, 0034, 0039–0041, 0043, 0045–0046, 0048–0049, 0051, 0060) are deleted ADRs — decisions superseded, merged, withdrawn, or absorbed into CONTEXT.md, code comments, and tests. 0017's decision (DB Service Restore creates a new DB Service) lives on as the CONTEXT.md definition; 0008's, 0016's, and 0034's modeling lives on in CONTEXT.md entries; 0048's snap-only width rule lives on as the pane-motion comment in `packages/ui/src/styles/globals.css`; 0020's shared-UI boundary and 0049's DB Access state ownership were retired with their records.
- Rules that outlived their record live as comments at the gate that enforces them: 0021's and 0022's placement persistence in `layout/patch.ts` and `layout/global-placement.ts`, 0040's measured footprints in `layout/placement-node.ts`, 0041's node-identity comparison in `canvas/canvas.node-merge.ts`, and 0031's submission ownership in `resource-settings/settings-submissions.ts`.
