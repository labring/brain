# Let Project Runtime Own Resource Read-Side Facts

Project Canvas resource cards now start from a Project Runtime read-side boundary: AP, DB, AP Public Access Node, and template-native workload fetch results are committed into app-owned facts, Canvas derives thin lookup shells from those facts, and node views adapt per-node runtime models into shared UI props. We choose this clean cut because keeping ReactFlow node arrays as the transport for resource facts, Settings source data, callbacks, and layout presentation state makes small resource updates invalidate too much Canvas state and keeps Settings coupled to the Canvas entry path.

## Considered Options

- Keep the legacy fat ReactFlow node array as a compatibility path: rejected because it preserves the old mixed resource model, view model, command bus, and Settings launch bridge in `node.data`.
- Move Settings editing source data into the Project Resource Read Model: rejected because AP and DB Settings providers own exact editable backing, Settings Drafts, submit behavior, and conflict handling.

## Consequences

Resource facts are app-owned read-side facts rather than shared UI prop objects or raw resources. Canvas shell topology should change only when resource identities change, while per-node runtime models absorb AP, DB, and AP Public Access fact updates.
