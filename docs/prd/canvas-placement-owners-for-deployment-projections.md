# PRD: Canvas Placement Owners for Deployment Projections

Status: Local PRD, ready for implementation agent

## Problem Statement

Project Canvas currently has fragile placement behavior around Deployment Placeholder Nodes and real resource nodes. Deployment projection positions live on Deployment Task Projection, while real AP, DB, AP Public Access, and template-native resource positions live in Canvas Layout. Deployment Handoff therefore depends on timing between projection writes, resource list refresh, layout merge, and layout persistence.

Users experience this as placeholder-to-resource handoff placing real nodes incorrectly, jumping nodes, or requiring special rules for generic placeholders versus result previews. The current model also splits projection shape into generic placeholder and result preview, even though both are the same product idea: a Deployment Task projects one or more temporary canvas slots before actual resources appear.

The implementation needs to simplify this by making Canvas Layout the single authoritative Canvas Placement Store for both resource placements and deployment projection placements, while keeping the domain boundary clear: a Deployment Placeholder Node is not a resource.

## Solution

Introduce a Canvas Placement Owner model. Every persisted canvas position belongs to a stable owner, not to a rendered node instance. Owners can be resource owners or deployment projection slot owners. Canvas Layout becomes the only authoritative Canvas Placement Store for these owners.

Deployment Task Projection must no longer own positions. It only describes deployment projection facts: Deployment Projection Slots, Deployment Preview Edges, Deployment Projection Evidence, task status, and explicit expected-to-actual result mappings.

Replace the generic/result-preview split with a unified Deployment Projection Slot model:

- A task with unknown result shape has one stable unknown slot.
- Once structured Deployment Projection Evidence exists, concrete slots replace or expand the unknown slot.
- A Deployment Placeholder Node is rendered for any unmatched Deployment Projection Slot that does not yet have a live resource node.
- Deployment Preview Edges connect slots, not shape-specific nodes.

Projection Reconciliation compares Deployment Projection Slots with actual resource state. Resource state is authoritative. Projection state is advisory. Deployment Handoff happens only when a slot has a Projection Match through exact anticipated resource identity or explicit expected-to-actual mapping. When handoff occurs, Canvas Layout rekeys the deployment projection placement to the resource owner if the resource does not already have placement. If the resource already has placement, the resource placement wins and the projection placement is consumed.

All placement changes from Projection Reconciliation should be applied as revision-checked Canvas Layout transactions. User Canvas Placement is authoritative and must not be overwritten by generated placement, projection refinement, or handoff.

## User Stories

1. As a Project Canvas user, I want a deployment placeholder to appear while a Deployment Task is active, so that I can see where deployment progress belongs in my project.
2. As a Project Canvas user, I want the placeholder position to be preserved when the real AP appears, so that the canvas does not jump after deployment completes.
3. As a Project Canvas user, I want the placeholder position to be preserved when the real DB appears, so that database deployments feel continuous.
4. As a Project Canvas user, I want AP Public Access placeholders to hand off only when their matching public access node exists, so that public access does not steal another resource's placement.
5. As a Project Canvas user, I want a real resource with an existing saved placement to keep that placement, so that deployment reconciliation never overrides my arranged canvas.
6. As a Project Canvas user, I want dragging a deployment placeholder to affect the placement inherited by the matching real resource, so that my manual arrangement before handoff matters.
7. As a Project Canvas user, I want dragging one placeholder in a deployment slot group to move the group by default, so that related anticipated results stay visually coherent.
8. As a Project Canvas user, I want deployment placeholders to disappear when a task fails or is cancelled, so that the canvas does not show resources that will not arrive.
9. As a Project Canvas user, I want completed deployments to keep unmatched placeholders briefly while resource lists reconcile, so that a successful deployment does not flicker between placeholder and empty canvas.
10. As a Project Canvas user, I want unmatched placeholders to expire after the reconciliation grace window, so that the canvas does not permanently show missing resources.
11. As a Project Canvas user, I want extra actual resources to appear even if they were not projected, so that resource state remains authoritative.
12. As a Project Canvas user, I want extra actual resources without projection placement to get First Canvas Placement, so that they still appear predictably.
13. As a Project Canvas user, I want incorrectly predicted resources not to hijack placement from similarly named real resources, so that the canvas remains trustworthy.
14. As a Project Canvas user, I want task projections to avoid fuzzy matching, so that placement handoff never depends on guesses.
15. As a Project Canvas user, I want the current viewport to follow new deployment placements without defining shared placement, so that my session feels responsive without changing other users' layout.
16. As a Project Canvas user, I want pending AP-to-DB setting edits to remain separate from Deployment Projection Slots, so that settings drafts do not create fake deployment resources.
17. As a Project Canvas user, I want multiple concurrent deployments to keep their placeholders independent, so that one task does not draw edges or positions through another task's slots.
18. As a Project Canvas user, I want preview edges to disappear when real Canvas Connections exist, so that temporary deployment relationships do not duplicate established runtime dependencies.
19. As a Project Canvas user, I want real Canvas Connections to remain derived from saved resource state, so that deployment preview edges do not become permanent relationships.
20. As a Project Canvas user, I want user-moved resource placement to survive refreshes, handoff, and stream updates, so that my canvas arrangement is stable.
21. As a Project Canvas user, I want generated placement to fill only missing owner positions, so that existing user-arranged canvas structure is not reinterpreted.
22. As a Project Canvas user, I want deployments that produce AP plus DB plus Public Access to hand off each matched result as it appears, so that I can use resources as soon as they exist.
23. As a Project Canvas user, I want unresolved slots to remain visible while other slots from the same task hand off, so that partial deployment progress is understandable.
24. As a Project Canvas user, I want resource names that are remapped by deployment results to hand off only when the mapping is explicit, so that generated names can still inherit placement safely.
25. As a product engineer, I want one Canvas Placement Store, so that handoff does not depend on synchronizing positions across Deployment Task Projection and Canvas Layout.
26. As a product engineer, I want Deployment Task Projection to contain no positions, so that projection schema describes only deployment facts.
27. As a product engineer, I want a deep Projection Reconciler module, so that matching, expiry, handoff, and first placement behavior can be tested without React.
28. As a product engineer, I want placement commands applied transactionally with layout revision checks, so that concurrent clients do not overwrite each other.
29. As a product engineer, I want revision conflicts to reload and rerun reconciliation, so that the latest layout always wins over stale placement commands.
30. As a product engineer, I want old Canvas Layout resource nodes to migrate into resource placement owners, so that existing projects keep their saved positions.
31. As a product engineer, I want old deployment projection position fields removed during migration, so that new code does not keep writing two position systems.
32. As a product engineer, I want slot identities to be stable and task-scoped, so that SSE refreshes and resource list refreshes rebuild the same canvas projection.
33. As a product engineer, I want projection edges scoped by task and slot, so that two deployments expecting the same resource identity do not cross-wire.
34. As a product engineer, I want behavior tests around mismatch scenarios, so that projection incompleteness is handled as normal product behavior.
35. As an implementation agent, I want clear module boundaries and data contracts, so that I can execute the migration without rediscovering the architecture.

## Implementation Decisions

- Follow the domain language in the glossary and the accepted ADR for Canvas Placement Owners for Deployment Projections.

- Canvas Layout is the authoritative Canvas Placement Store. Do not create a separate deployment projection placement table or document.

- Canvas Placement Owner is the stable identity for a persisted position. Rendered React Flow node ids are not placement identities.

- Deployment Task Projection must not own canvas positions. Remove projection-level position fields and slot-level position fields instead of keeping compatibility reads.

- Use a unified Deployment Projection Slot model. Do not keep generic placeholder and result preview as separate projection shapes in the long-term model.

- Decision-rich target type shape:

```ts
type CanvasPlacementOwner =
  | { kind: "resource"; ref: CanvasResourceRef }
  | { kind: "deploymentProjection"; taskId: string; slotId: string };

type CanvasPlacement = {
  owner: CanvasPlacementOwner;
  position: { x: number; y: number };
  source: "generated" | "user";
};

type DeploymentTaskProjection = {
  taskId: string;
  projectId: string;
  status: DeployTaskStatus;
  completedAt?: string | null;
  slots: DeploymentProjectionSlot[];
  edges: DeploymentPreviewEdge[];
  resultMappings?: DeploymentResultMapping[];
};

type DeploymentProjectionSlot = {
  id: string;
  expectedRef?: CanvasResourceRef;
  anchor?: boolean;
  evidence?: string[];
};

type DeploymentResultMapping = {
  slotId: string;
  actualRef: CanvasResourceRef;
};
```

- Unknown slot identity is stable within a Deployment Task. Use a single unknown slot id when result shape is not known.

- Concrete slot identity is derived from the anticipated result reference. The global placement owner combines task identity and slot identity, so two tasks can safely use the same concrete slot id without colliding.

- Slot group anchor rules remain local to layout: explicit anchor wins; otherwise AP before DB; DB before TemplateNative; AP Public Access is never the anchor.

- Unknown slot refinement consumes the unknown slot. When structured evidence appears, the unknown slot placement should rekey to the anchor concrete slot placement, preserving `source: "user"` if the user moved it.

- Secondary concrete slots get generated placements as a Deployment Projection Slot Group, respecting Canvas Placement Occupancy and existing placements.

- Deployment Projection Evidence can include generated manifests, artifact summaries, template previews, AP public access intent, AP-to-DB relationship fields, or explicit expected result contracts. Natural-language task text and broad task type are not evidence.

- Deployment Preview Edges require explicit evidence. Sharing one Deployment Task is not enough to create an edge.

- Projection Reconciliation treats actual resource state as authoritative and deployment projection as advisory.

- Projection Match is required for handoff. A match can be exact `expectedRef` identity or explicit expected-to-actual result mapping. Do not match by fuzzy name, creation time, resource count, or natural-language inference.

- If actual resource state contains a resource with no matching projection slot, render it as a normal resource and create placement through First Canvas Placement if needed.

- If projection contains a slot with no matching resource, keep it visible while the task is active.

- If projection contains an unmatched slot for a completed task, keep it during a reconciliation grace window, then expire it and delete its deployment-owned placement.

- If projection contains an unmatched slot for a failed or cancelled task, remove the placeholder and delete its deployment-owned placement.

- Deployment Handoff is per slot. Do not wait for all slots in a Deployment Projection Slot Group before handing off matched slots.

- Handoff uses rekey or consume semantics, not copy:
  - If the resource owner has no placement and the deployment slot owner has placement, rekey the slot placement to the resource owner.
  - If the resource owner already has placement, keep the resource placement and delete or consume the deployment slot placement.
  - If neither owner has placement, create resource placement through First Canvas Placement.

- User Canvas Placement is authoritative:
  - Handoff must not overwrite an existing resource owner placement.
  - Generated movement must not overwrite an existing user placement.
  - Refinement from unknown slot to concrete slot preserves user source.

- Placement changes from Projection Reconciliation are applied as revision-checked transactions. Do not scatter best-effort PATCH calls from independent React effects.

- Placement command interface:

```ts
type PlacementCommand =
  | { kind: "create"; owner: CanvasPlacementOwner; position: Point; source: "generated" | "user" }
  | { kind: "move"; owner: CanvasPlacementOwner; position: Point; source: "generated" | "user" }
  | { kind: "rekey"; fromOwner: CanvasPlacementOwner; toOwner: CanvasPlacementOwner }
  | { kind: "delete"; owner: CanvasPlacementOwner };
```

- Apply placement commands against an expected Canvas Layout revision. On stale revision, reload the layout, rerun Projection Reconciliation, and apply the newly computed commands.

- Deep modules to build or modify:
  - Canvas Placement Owner model: owns resource and deployment projection owner identity, serialization, equality, and sort keys.
  - Canvas Layout repository and patch layer: stores placements by owner and applies transactional placement commands.
  - Deployment Projection Builder: derives slots, preview edges, evidence, status, and explicit expected-to-actual mappings without positions.
  - Canvas Item Projector: joins resources and Deployment Task Projections into canvas items with placement owners.
  - Projection Reconciler: pure decision module that computes Projection Match, Deployment Handoff, Projection Slot Expiry, and First Canvas Placement commands.
  - Placement algorithm adapter: computes generated positions for owners lacking placement, including Deployment Projection Slot Groups.
  - Canvas Render Model adapter: turns canvas items plus resolved placements into React Flow nodes and edges.

- Current Pending Database Binding Intent behavior stays separate. Pending AP-to-DB edges from AP environment drafts are not Deployment Projection Slots and do not participate in Deployment Handoff.

- Project-level deployment projection streaming remains the delivery model. The stream should carry projection facts, not placement positions.

- Viewport follow remains session-local. It may follow generated or newly rekeyed placement, but it must not define shared Canvas Layout.

- Migration should be staged:
  - Introduce owner-based Canvas Layout model and migrate existing resource node layout into owner placements.
  - Add Projection Reconciler and command applier under tests.
  - Stop writing deployment positions to Deployment Task Projection.
  - Derive placeholder nodes from projection slots plus Canvas Layout placements.
  - Remove old shape and projection-position fields rather than keeping compatibility branches.

## Testing Decisions

- Tests should assert external behavior and product contracts, not internal helper call order. Good tests provide resources, deployment projections, Canvas Layout, and expected render model or placement commands.

- The Projection Reconciler should be a deep module with extensive pure tests. It should not depend on React, SWR, SSE, or React Flow.

- The placement command applier should be tested as a deep module around revision handling, rekey semantics, user placement priority, and idempotency.

- The Deployment Projection Builder should be tested around slot identity, evidence sources, expected-to-actual mappings, and absence of position output.

- The Canvas Item Projector should be tested around rendering placeholders only for unmatched slots, rendering real resources for actual resource state, preview edge creation, and task scoping.

- The placement algorithm adapter should reuse existing placement behavior tests where possible: row-major global placement, placement occupancy, AP plus PublicAccess placement groups, and generated position behavior.

- Prior art to reuse:
  - Resource snapshot tests that verify placeholder projection, handoff, unresolved slot behavior, and layout intent.
  - Deployment placeholder tests that verify group movement and projection patch behavior.
  - Placement tests that verify row-major placement, occupancy, placement groups, and first placement persistence.
  - Deployment projection tests that verify visible statuses and completed grace behavior.
  - Pending connection tests that verify client-only pending AP-to-DB edges stay separate from established Canvas Connections.
  - Layout patch, merge, scheduler, and repository tests for persistence and revision-like behavior.

- Required behavior test matrix:
  - Existing resource layout migrates to resource placement owner.
  - Unknown deployment slot renders one placeholder when task is active.
  - Unknown slot placement rekeys to the anchor concrete slot when evidence arrives.
  - Concrete AP slot exact matches AP resource and handoff rekeys placement.
  - Concrete DB slot exact matches DB resource and handoff rekeys placement.
  - PublicAccess slot exact matches AP Public Access node and handoff rekeys placement.
  - Explicit expected-to-actual mapping allows handoff when actual resource name differs.
  - No fuzzy matching: similar names do not handoff.
  - No count-based matching: one AP created for one AP slot does not handoff without identity or mapping.
  - Actual extra resource without slot uses First Canvas Placement.
  - Projection slot without actual resource remains while task is active.
  - Projection slot without actual resource remains during completed grace.
  - Projection slot without actual resource expires after completed grace.
  - Projection slot without actual resource is removed on failed task.
  - Projection slot without actual resource is removed on cancelled task.
  - Resource placement existing before handoff wins over projection placement.
  - User resource placement is not overwritten by generated placement.
  - User deployment projection placement preserves `source: "user"` through unknown-to-concrete refinement.
  - Multiple slots from one task can handoff in one transaction.
  - One slot can handoff while unresolved sibling slots remain visible.
  - Multiple concurrent tasks with the same expected resource identity do not cross-wire placeholders or preview edges.
  - Preview edge is not emitted when an established Canvas Connection already exists for the same rendered pair.
  - Placement command transaction fails or retries cleanly on stale revision.
  - Re-running Projection Reconciliation after revision conflict produces idempotent commands.
  - Viewport follow behavior does not write Canvas Layout.
  - Pending Database Binding Intent edges remain independent from Deployment Projection Slots.

## Out of Scope

- Building task detail panes, failure nodes, detailed status cards, or existing-resource update badges.
- Changing Deployment Task lifecycle ownership or making Assistant Chat own deployment progress.
- Changing AP, DB, AP Public Access, or Database Binding domain semantics.
- Replacing the project-level deployment projection stream with a different transport.
- Creating a new product workflow for resolving projection mismatches manually.
- Supporting per-slot manual placement as the default interaction model.
- Reworking general Canvas UI styling or node component design.
- Publishing this PRD to an issue tracker.
- Preserving Crossplane-era naming or compatibility.

## Further Notes

- This PRD intentionally revises the old placeholder model. Generic placeholder and result preview should not continue as separate long-term projection shapes.

- Resource state is authoritative. Projection state helps the canvas present deployment progress and preserve placement, but it must never force resources to match projection.

- The riskiest implementation area is keeping old Canvas Layout or Deployment Task Projection position semantics alive by accident. Prefer explicit migration steps and behavior tests over compatibility branches.

- The second riskiest area is concurrency. The implementation should favor pure reconciliation plus revision-checked command application over effects that patch placement opportunistically.

- The agent should keep glossary and ADR language in sync if implementation reveals a necessary terminology correction.
