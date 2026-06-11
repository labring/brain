# Persist First Incremental Canvas Placements

Incremental Canvas Placement persists the first accepted position for a canvas node or Canvas Placement Group that does not yet have a Canvas Layout position. The save is scoped to newly placed nodes and must not rewrite unrelated Canvas Layout nodes, because existing layout positions represent user-arranged project structure.

## Considered Options

- Keep generated positions unsaved until direct user movement: rejected because AP Public Access Nodes and other related new nodes would need extra anchor-following rules to avoid jumping after refresh or partial saves.
- Auto-layout and save the whole canvas whenever resources change: rejected because resource discovery should not reinterpret user-arranged Canvas Layout.
- Let later first-placement writes overwrite earlier ones: rejected because concurrent clients may discover the same missing node from different snapshots, and an already persisted Canvas Layout position should win.

## Consequences

First placement writes are idempotent when they match the saved position. If a later first-placement write proposes a different position for a node that already has a Canvas Layout position, the saved position remains authoritative and the client should reconcile to the returned layout.
