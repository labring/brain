# Project Canvas Deployment Placeholders

Project Canvas should show one lightweight Deployment Placeholder Node for an active Deployment Task once the task has resolved its target Project. The placeholder is a task projection, not a pending AP, DB, AP Public Access Node, or template workload, so its identity and temporary position belong to deployment task projection state rather than durable Canvas Layout.

The placeholder appears as a generic skeleton, does not create Canvas Connections or expose resource actions, and disappears on failure or cancellation. On success, it remains only until resulting resource nodes appear or a short reconciliation window expires; when a Primary Deployment Result has no existing Canvas Layout position, it inherits the placeholder's temporary position and the placeholder disappears.

Initial placement is chosen by the Project Canvas that first projects an unplaced placeholder, preferably near the current viewport unless the deployment has an explicit resource anchor; existing canvas selection alone is not an anchor. The first recorded placement wins until a user intentionally moves the placeholder. Visible placeholders participate in placement occupancy, but handoff does not override an existing Canvas Layout position for a resulting resource.

Handoff uses the Deployment Task's declared result resources, such as `artifactSummary.resources`, rather than naming conventions or creation time. The first implementation includes task-list projection, skeleton rendering, temporary position persistence, successful handoff, and automatic disappearance for failed, cancelled, or expired completed tasks; task detail panes, failure nodes, detailed status cards, and existing-resource update badges are out of scope.

## Considered Options

- Model deployment progress as pending resource nodes: rejected because task start does not reliably know the final resource type, name, or count, and pending resource identities would blur the boundary between Deployment Tasks and saved AP/DB/resource state.
- Persist placeholders in Canvas Layout: rejected because Canvas Layout is durable Project resource arrangement, while deployment placeholders are temporary task projections.
- Hide the placeholder immediately when a task completes: rejected because task completion and resource-list reconciliation can be briefly out of sync, producing a visible gap before the real node appears.
