# Use Row-Major Global Canvas Placement

Incremental Canvas Placement uses row-major global placement for new unanchored canvas nodes: candidates are considered in a left-to-right, top-to-bottom reading order, and the chosen position should keep the overall canvas footprint near a soft 2:1 width-to-height shape rather than extending indefinitely to the right. Existing Canvas Layout positions remain authoritative and are not rearranged by this rule.

## Considered Options

- Continue opening new global placement blocks to the right of the saved layout: rejected because projects drift into long horizontal strips, and late-arriving related nodes such as AP Public Access Nodes can permanently widen the canvas.
- Place unanchored nodes near the current viewport: rejected for first placement because Canvas Layout is shared project metadata while viewport position is session-local.
- Add only public-access-specific placement exceptions: rejected because it addresses one symptom without fixing the global fallback rule that makes ordinary AP and DB creation keep widening the canvas.

## Consequences

Unanchored first placements remain deterministic and append-only: new nodes are placed without moving existing saved positions or filling arbitrary holes in the middle of a user-arranged canvas. When a new AP has desired Public Address intent, the AP and AP Public Access Node are evaluated as one Canvas Placement Group with fixed internal layout and one combined footprint; placement chooses a position for that footprint, then expands it into the individual Public Access and AP node positions.

## Status

The Canvas Placement Group mechanism above is generalized to Canvas Placement Clusters by [ADR-0039](0039-regenerate-auto-layout-as-clustered-row-major-grid.md), which also gives whole-canvas regeneration (the Auto layout gesture) a backfilling row-major grid. The append-only global placement rule in this record remains authoritative for Incremental Canvas Placement.
