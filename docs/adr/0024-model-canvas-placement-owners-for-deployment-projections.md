# Model Canvas Placement Owners for Deployment Projections

Project Canvas uses one authoritative Canvas Layout as the Canvas Placement Store for both real resources and deployment projections. Placements are keyed by Canvas Placement Owner: either a resource owner or a deployment projection slot owner. Deployment Task Projection contains projection facts only: slots, preview edges, evidence, status, and explicit expected-to-actual result mappings; it does not own canvas positions.

Deployment projection is modeled as one or more Deployment Projection Slots. A task with unknown result shape has one stable unknown slot; once structured evidence exists, concrete slots replace or expand that unknown slot. Generic placeholder and result preview are not separate projection shapes: both are renderings of the same slot model. A Deployment Placeholder Node is only the temporary canvas rendering for an unmatched slot, not an AP, DB, AP Public Access Node, template workload, resource action target, or Canvas Connection endpoint.

The unknown slot placement represents the visual origin of the task's Deployment Projection Footprint until concrete slots are known. When structured evidence arrives, the unknown placement is consumed into concrete slot placements using the footprint's relative slot layout; it is not blindly rekeyed to the anchor slot. Generated unknown placements may be refined by footprint placement, but user-arranged unknown placements remain authoritative even when the expanded footprint overlaps existing nodes.

Within a Deployment Projection Footprint, AP Public Access Node slots keep a generated visual pairing with their owning AP slots. That pairing applies to every AP/Public-access pair in the footprint, not only to the footprint anchor. The pairing guides generated placement and initial placement derivation; it does not override placements the user has arranged separately for either slot.

The projection-to-resource reconciliation step compares Deployment Projection Slots with actual resource state. Resource state is authoritative and projection state is advisory. A Deployment Handoff happens only when a slot has a match: either exact anticipated resource identity or an explicit expected-to-actual mapping from deployment results. Fuzzy matching, creation-time matching, count-based matching, and natural-language inference are not valid handoff evidence.

When handoff occurs and the resource has no placement, Canvas Layout rekeys the deployment projection slot placement to the resource owner. If the resource already has a placement, the resource placement wins and the projection placement is consumed. Handoff may complete per slot; unmatched slots remain visible while the task is active, remain for a completed reconciliation grace window, and are removed when the task fails, is cancelled, or expires after completion.

Placement changes from projection-to-resource reconciliation should be applied as revision-checked Canvas Layout transactions rather than independent best-effort patches. User Canvas Placement is authoritative: generated placement, projection refinement, and handoff must not overwrite a user-arranged resource placement.

User-arranged deployment projection placement is also authoritative within the projection lifecycle. When a user-arranged projection placement is handed off to a resource, the resulting resource inherits that user placement intent. Once a slot has handed off, remaining projection slots do not move the resulting resource as part of footprint refinement.

## Considered Options

- Keep deployment positions on Deployment Task Projection: rejected because it creates a second position system and makes handoff depend on cross-system timing between task projection writes, resource list refresh, and Canvas Layout saves.
- Keep generic placeholder and result preview as separate shapes: rejected because a generic placeholder is just an unknown Deployment Projection Slot, and the shape split adds special-case upgrade and placement inheritance rules.
- Treat the unknown slot placement as the concrete anchor slot placement: rejected because AP/Public-access previews and multi-result deployments can shift sibling slots around the previous placeholder position, causing deployment result groups to change meaning when structured evidence arrives.
- Add a separate footprint-origin placement owner: rejected for now because deployment projection placements can preserve one Canvas Layout owner per slot by consuming the unknown slot into concrete slot placements during refinement.
- Copy projection placement to resource placement during handoff: rejected because it leaves two authoritative-looking position facts during cleanup. Rekeying or consuming the projection placement keeps one position fact.
- Store deployment projection placements in a new table or document: rejected because Canvas Layout already owns project-scoped visual arrangement, and a separate store would preserve the cross-store handoff problem.
- Match projected slots to resources by fuzzy name, creation time, or result count: rejected because an incorrect match would move placement to the wrong resource and be difficult for users or maintainers to explain.

## Consequences

Canvas Layout needs a placement owner model that can represent both resource placements and deployment projection slot placements. Canvas Layout resource nodes use resource placement owners as their identity; Deployment Task Projection schema does not include placement fields. Project Canvas derives placeholder nodes by joining deployment slots with Canvas Layout placements rather than reading positions from the task projection.

Projection refinement needs to distinguish generated placement from user-arranged placement. Generated footprint placement can move to avoid collisions; user-arranged footprint origins and concrete slot placements should remain where the user put them. Handoff remains per slot even when placement refinement considers the full Deployment Projection Footprint.
