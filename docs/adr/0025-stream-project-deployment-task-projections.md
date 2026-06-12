# Stream Project Deployment Task Projections

Project Canvas should bootstrap Deployment Task Projections with a bounded Project-scoped read, then subscribe to one Project-scoped deployment projection stream for changes. We choose a Project-level stream over continuous task-list polling because Canvas needs the current Project's deployment projections, not repeated full task history reads; we choose it over one stream per task because Canvas is a Project surface and should not multiply connections as concurrent deployments grow.

## Considered Options

- Keep polling `GET /api/deploy-tasks` while the Project Canvas is visible: rejected because it repeatedly reads unchanged task lists, couples Canvas freshness to a fixed interval, and encourages passing deployment authentication through URLs.
- Subscribe to one stream per Deployment Task: rejected for Canvas because task detail surfaces may need task-specific streams, but the canvas only needs the Project-scoped set of visible deployment projections.
- Skip bootstrap and rely only on live stream events: rejected because refreshed tabs, restored sessions, and reconnects need a current snapshot before live changes resume.

## Consequences

`GET /api/deploy-tasks` should become a bootstrap and recovery read rather than a high-frequency refresh loop. Deployment creation responses can seed the local projection immediately, while the Project deployment projection stream carries status, phase, artifact summary, and terminal changes until placeholder handoff or removal.
