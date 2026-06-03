# Derive Canvas Connections from Resource State

Established Canvas Connections are derived from AP, DB, and EntryPoint product/API state plus observed dependency evidence rather than stored as freeform diagram edges or separate App Postgres records. Users may drag lines on the canvas, but only supported relationships become commands; unsupported Connecting Edges are discarded after lightweight feedback.

## Considered Options

- Persist arbitrary user-drawn canvas edges: rejected because canvas edges should represent real runtime dependencies, not annotations.
- Store AP-DB binding edges in App Postgres: rejected because Database Binding belongs to AP desired state and should be detected from the AP environment plus DB state.
- Parse arbitrary DSN strings to infer DB relationships: rejected because fuzzy detection can create false AP-DB edges.

## Consequences

Canvas AP-DB detection uses exact evidence only: a Secret reference to a DB credential Secret, or an env value equal to the DB's current private or public DSN. Multiple env references between one AP and DB collapse to one rendered canvas edge.
