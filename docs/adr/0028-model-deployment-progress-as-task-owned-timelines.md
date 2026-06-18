# Model Deployment Progress as Task-Owned Timelines

Deployment progress should be presented through a Deployment Task Timeline owned by the Deployment Task, not through Assistant Chat, browser-only state, or a fixed global phase list. Each Deployment Runner defines stable user-facing Deployment Timeline Steps for its task run; backend runner phases may differ from these steps and can be projected into them for display.

When a task reaches the step that creates result resources, the timeline should show Deployment Result Resource Cards for known user-visible result resources. These cards are not Project Canvas nodes, Deployment Projection Slots, or raw Kubernetes object cards. Required cards determine Deployment Result Readiness; the task reaches `completed` only after required result resource cards reach the shared task-facing running state.

## Considered Options

- Use one fixed product timeline for every runner: rejected because direct, template, and AI runners do different user-visible work before resources are created.
- Render deployment progress from frontend-only aggregation of task status and resource APIs: rejected because refreshes, reconnects, retries, and background task progress need a task-owned source of truth.
- Show every applied Kubernetes object as a resource card: rejected because users need progress for deployment result resources, while support objects should only explain those result resources.
- Persist all raw Kubernetes events into the task timeline: rejected because the timeline should preserve normalized deployment-relevant events rather than becoming a low-level event dump.

## Consequences

Deployment Task storage should keep a current timeline projection or snapshot alongside append-only task events. Runners and resource observers should update timeline steps, result resource cards, and normalized card events while preserving stable step and card identity. The Deployment Task Timeline pane can render from this task-owned model, while existing Canvas projection and handoff logic remain separate.
