# Size Canvas Placement Footprints from the Measured Render

A Canvas Node Footprint takes its height from the node's measured render, because card heights are content-driven — an expanded database card is taller than an expanded container card, which is taller than an access-domain card — and any constant drifts the next time a card gains a row. The expansion-state constants remain only as pre-measurement fallbacks, sized conservatively above the tallest known card so fallback placement spreads out rather than overlaps. The same rule applies on both sides of a collision test: a placement candidate's footprint and the occupancy rectangles of already-placed nodes both resolve to the rendered card when one exists; only ghost layout entries with no rendered node (missing-resource grace) fall back to their persisted expansion state. Measured heights are never persisted — the Canvas Layout document keeps storing intent (position and expansion) while heights stay read-side facts of the current render, consistent with ADR 0029.

Inside a Canvas Placement Cluster, rows stay uniform so barycenter assignment keeps its meaning, but the row pitch stretches to the tallest member's footprint plus a minimum vertical clearance. Global placement follows the same principle vertically: regeneration rows are shelves — each new row sits one clearance below an allocated rect's bottom edge, and incremental appends clear the bottom-most card by the same clearance — so tall cards neither overlap the next row nor strand it a full empty row step away. `COLUMN_STEP` remains the horizontal quantum, `ROW_STEP` remains the snuggle-offset quantum and soft-shape scale, and real-rectangle collision testing is what prevents overlap. This corrects an implicit assumption in ADR 0039, whose row-major grid treated the row step as both sufficient and necessary row height. For canvases of cards shorter than the row step, shelf rows land exactly on the old fixed-step rows.

## Considered Options

- Per-node-type expanded-height constants: rejected because the defect recurs the next time any card's content grows; constants can only chase the render.
- Persisting measured heights in the Canvas Layout document: rejected because heights change with card content, making the persisted value a staleness liability, and because placement always runs in a session where the rendered card is available anyway.
- Raising `ROW_STEP` above the tallest card: rejected as a bandaid that spaces every short card for the worst case and still breaks on the next taller card.
- Variable-height (cumulative) stacking inside clusters: rejected because it dissolves the row concept that barycenter assignment and AP–DB top alignment depend on.
- Height-aware snuggle offsets for tall anchors: rejected for now; quantized candidates that fail real-rectangle checks fall through to global placement, which never overlaps. Revisit if appended-instead-of-snuggled placements become a felt problem.

## Consequences

- Whole-canvas regeneration stays deterministic and idempotent at gesture time: the same rendered canvas produces the same layout, because measured heights are stable inputs once cards are rendered.
- First layout before measurement uses the conservative fallback and is airier than a measured layout; the next Auto layout gesture tightens it. Runtime re-expansion of a collapsed card on a packed canvas can still overlap neighbours — placement guarantees hold at placement time only, and Auto layout is the recovery gesture.
- Shelf rows align their tops only while shelf members share a height; a short card in a tall shelf can accept a backfilled neighbour under it, giving locally staggered tops in mixed-height rows — accepted as the same trade backfilling already makes.
- Tests pin card heights explicitly (measured on the node) instead of inheriting geometry from placement constants.
