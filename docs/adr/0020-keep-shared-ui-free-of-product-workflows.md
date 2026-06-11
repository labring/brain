# Keep Shared UI Free of Product Workflows

`packages/ui` is the shared UI package for reusable primitives, visual components, and host-driven composites. Product workflows, resource settings semantics, app routing, data loading, draft lifecycles, and complete feature panes belong in the owning app or feature boundary instead of the shared UI package, even when they render reusable components from `packages/ui`.

This keeps shared UI usable as a component system rather than turning it into a second product application layer. Host-driven product components such as canvas nodes may remain shared when their product vocabulary is passed in by props and they do not own the surrounding workflow.

## Consequences

Feature-level surfaces such as project creation, deployment flows, AP settings, DB settings, history panes, and product explorers should migrate out of `packages/ui` as their owners are clarified. `packages/ui` should retain the reusable controls and layout primitives extracted from those surfaces.

The Component Registry should not preview product workflows or panes that migrate out of `packages/ui`. Project creation, deployment flows, workload history, AP settings, and the full canvas surface should be removed from the registry catalog rather than re-pointed at app-owned feature modules.

This boundary applies to both `components` and `lib` in `packages/ui`. Product models and helpers such as AP environment parsing, AP network settings, deployment settings, and settings draft lifecycle helpers should move with their owning app features unless they are deliberately generalized into product-agnostic UI utilities.

Chat and AGUI surfaces are app-owned when they include product actions such as GitHub, Docker, database, or template deployment, or when their generated UI catalog references product workflows. A generic chat shell may be extracted into shared UI only after product-specific composer actions, tool rendering, and catalog entries are supplied by the host.
