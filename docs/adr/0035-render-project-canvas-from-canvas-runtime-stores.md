# Render Project Canvas from Canvas Runtime Stores and Stable Commands

Project Canvas rendering becomes store-first: Canvas Runtime owns canvas presentation state in framework-external subscription stores, views subscribe per concern with fine-grained selectors, and every node interaction dispatches through one Canvas Command Bus whose identity never changes across renders. ReactFlow node arrays carry only presentation shells, and node `data` never carries callbacks, resource facts, or metrics. We choose this because the remaining fat-node decorator path rebuilds every node's `data` identity whenever selection, stack order, lifecycle loading, or a surface slot changes, which invalidates the whole canvas even though per-node subscription infrastructure already exists for facts, selection, and telemetry.

This completes the cut started by ADR 0029: that decision moved resource facts out of ReactFlow node arrays, and this decision moves out the rest — commands, layout presentation state, viewport behavior, and route subscription.

The store-first contract has five parts:

- **Shell topology.** Every ReactFlow node is `id`, `type`, `position`, `zIndex`, and a lookup shell. Node views resolve states, actions, metrics, and connections per node from Canvas Runtime and Project Runtime stores. The legacy decorated full-data node path is removed rather than kept as a compatibility branch.
- **Stable commands.** Command planning stays in pure plan functions. Execution reads current store state instead of capturing nodes and route callbacks in closures, so the dispatch surface handed to node views is referentially permanent. Callbacks never enter node `data`.
- **Layout presentation store.** Positions, stack order, and expansion live in a Canvas Runtime layout store that merges persisted Canvas Layout with in-session gestures. The flow view is controlled from store-derived arrays with per-node identity preservation; it does not mirror nodes into local state and re-merge them.
- **Viewport directives.** Opening fit, focus, follow, and viewport insets are imperative directives on a viewport controller bridged to the ReactFlow API. Canvas meta shrinks to static configuration, so the shared canvas context stops changing after mount.
- **Single route-sync point.** One route-sync controller owns the URL subscription for the ADR 0014 slot model and mirrors it into project surface state. Canvas views, node views, and the project page never subscribe to search params.

Surface state additionally exposes Canvas Coverage (`none`, `partial`, `full`). A full-coverage Main Action Surface hides the canvas subtree with React Activity and throttles resource and telemetry refresh to background cadence until the canvas is revealed, reusing the page-visibility semantics that resource polling already honors.

## Considered Options

- Keep the decorated node array and patch memoization case by case: rejected because every new surface or node action reopens the same identity cascade, and ADR 0029 already rejected fat node arrays as the transport for per-node state.
- Adopt a general state library (zustand) for canvas state: rejected because hand-rolled subscription stores are already the canvas-layer pattern (Project Runtime facts, interaction, telemetry), jotai covers app-shell state, and a third state idiom adds cost without new capability.
- Distribute selection and surface state through React context values: rejected because context propagation bypasses memo boundaries and re-renders every consumer, which is the failure mode per-node subscription stores exist to avoid.
- Unmount the canvas beneath full-coverage surfaces: rejected because unmounting loses viewport, expansion, and gesture state and forces a full remount on close; Activity preserves state while skipping render work.

## Consequences

The node decorator array layer, the runtime model decorators context, the flow-level node mirror and merge, viewport focus/follow/insets fields in canvas meta, and page-level search-param subscription are deleted rather than kept behind flags. The project canvas page becomes a thin shell that mounts stores, controllers, the canvas view, and the surface layer.

Rendering scope becomes a testable invariant rather than an emergent outcome: opening or closing a Side Pane, Main Action Surface, or Session Drawer re-renders surface hosts and affected nodes only; a resource fact change re-renders its node; a telemetry tick re-renders that node's metrics subtree; a fully covered canvas renders nothing beneath the surface.

Canvas route-state transitions are local to the project workbench for rendering purposes. Changes to `selected`, `side`, `main`, or `drawer` must not re-render the App Sidebar or its Project Shortcuts unless their own pathname or Project inputs changed, and value-equal Canvas transitions must not enqueue URL or browser-history writes. This preserves the URL and Back behavior from ADR 0014 while keeping app chrome outside the Canvas rendering scope.

Resource sync, layout persistence, and route sync become mount-point controllers that write into stores. Command plan functions and layout/stack-order/merge helpers keep their pure-function form and existing tests; the refactor rewires React composition, not domain logic.

The shared `packages/ui` canvas stays product-free per ADR 0020: it accepts static configuration and controlled state and exposes an imperative viewport bridge. Product stores, command execution, and surface orchestration remain in the app's Canvas Runtime feature layer.

Migration lands as behavior-preserving strands in dependency order — stable command bus, shell-only nodes, layout store with a controlled flow view, viewport directives, route-sync isolation, then coverage pausing — each shippable on its own with unchanged product behavior.
