# Regenerate Whole-Canvas Auto Layout as a Clustered Row-Major Grid

Whole-canvas regeneration — the Auto layout gesture, and first layout when no Canvas Layout document exists — places Canvas Placement Clusters into a row-major grid scanned from the origin under a column cap, backfilling gaps in earlier rows. A cluster is a connected component of unplaced resource nodes, joined by PublicAccess–AP naming and detected AP–DB connections, laid out internally as `PA | AP | DB` columns: APs take rows in name order, each PublicAccess sits beside its AP, and each DB takes row `max(next open row, round(barycenter))` where the barycenter is the mean row of the APs it connects to. The column cap is `max(widest cluster span, round(√(2 · total span · ROW_STEP / COLUMN_STEP)))`, targeting the same soft 2:1 canvas shape Incremental Canvas Placement aims for. A cluster's footprint is its bounding box, so foreign units never backfill into gaps between cluster members.

## Considered Options

- Keep the shape-penalty frontier scan for the Auto layout gesture: rejected because the penalty wraps to a new row after a single wide unit and the scan never revisits earlier rows, leaving a permanent top-right hole that repeated Auto layout runs can never fill.
- Apply the backfilling grid to Incremental Canvas Placement as well: rejected because gaps in a user-arranged canvas can be deliberate; ADR-0022's append-only rule remains authoritative for incremental placement.
- Fold only single-owner DBs into their AP's unit and leave shared DBs unclustered: rejected because barycenter row assignment already settles a shared DB between the APs it serves, so whole components need no special cases.

## Consequences

- The former AP + PublicAccess Canvas Placement Group is the degenerate cluster with no DB members; its internal layout and persisted positions are unchanged. Clusters also form during Incremental Canvas Placement for co-created nodes and still snuggle up to already-placed neighbours through any member's connection anchors.
- Auto layout is deterministic and idempotent: rerunning it on a settled canvas produces no position changes.
- Hub-shaped clusters (one AP with many DBs) stack the DB column vertically without wrapping; column wrapping inside a cluster is a possible later refinement.
- Deployment projection footprints and placed deployment placeholders keep their existing placement rules; the column cap counts their occupancy so the regenerated grid flows around them.
