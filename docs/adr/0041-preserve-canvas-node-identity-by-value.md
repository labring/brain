# Preserve Canvas Node Identity by Comparing Node Data by Value

Canvas node identity preservation compares node `data` by structural value, not by object reference. `mergeNodes` keeps a node's previous identity when the incoming node's `data` is value-equal to the existing node's `data`, even though the incoming object is a freshly allocated literal. We choose this because the shell builder (`resourceShellData`) is a stateless projection that returns a new `{ runtime: … }` literal on every reconcile, so reference equality on `data` can never hold for an unchanged node — every reconcile would otherwise swap every node's identity and re-render the whole canvas.

This restores the per-node identity preservation that ADR 0035 relies on, without depending on an upstream invariant that no layer enforces. Reference stability of `data` was silently assumed by an earlier identity-preservation fix and regressed when the store-first refactor (ADR 0035) replaced the decorated-node path with a shell builder that rebuilds `data` on every call. Both changes were individually correct; the coupling between them was invisible because types and tests stayed green.

Value comparison is safe because ADR 0035 forbids callbacks, resource facts, and metrics in node `data`: `data` carries only presentation values (`kind`, `modelKey`, `observedUid`, `placementOwnerKey`, `resourceRef`, and placeholder presentation). Value-equal presentation renders identically, so preserving identity cannot drop a visible change. `observedUid` lives inside `data`, so a same-named resource replaced by a new instance changes `data` and correctly forces a re-render.

## Considered Options

- Intern `data` at the source — have the shell builder reuse the previous `data` object for unchanged nodes: rejected because it re-establishes the same fragile invariant that just regressed. It requires the builder and every downstream layer that re-spreads `data` (the layout/expand merge already does) to preserve the reference, and any future re-spread silently breaks it again with types and tests still green.
- Keep reference comparison and memoize the builder output: rejected for the same reason — correctness would depend on an unenforced upstream contract rather than on the gate that decides identity.

## Consequences

`mergeNodes` runs a small structural deep-equal over node `data` per node per reconcile. Node `data` is a handful of presentation fields, so this cost is far below the whole-canvas re-render churn it prevents.

The identity gate no longer couples to how upstream builds `data`. A future refactor that changes the builder or adds another `data`-rewriting layer cannot silently reintroduce the churn, because the gate asks whether the values are equal, not whether the object is the same instance.

The invariant is covered by tests on `mergeNodes`: a fresh but value-equal `data` preserves node identity, an `observedUid` change forces a new identity, a user-expanded node survives a value-equal collapsed tick, and array-bearing placeholder `data` is compared element-wise.
