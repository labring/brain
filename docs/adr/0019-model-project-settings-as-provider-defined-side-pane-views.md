# Model Project Settings as Provider-Defined Side Pane Views

Project Side Pane should host a generic settings surface entry instead of separate AP Settings, DB Settings, AP Environment Settings, and Public Addresses pane entries. The Side Pane remains a slot and shell; a new project settings feature resolves the Settings Owner target to a provider, and the provider owns data loading, draft behavior, presentation, and named Settings Views made from provider-local sections.

Settings Views are provider-defined product scopes, not arbitrary section bundles passed by callers. A view may contain one or more sections, defaults to `full` when omitted, falls back to `full` when an unknown view is requested, and saves or discards changes at view granularity. Switching away from a dirty view must resolve the current edits first so hidden unsaved changes are not carried into another view and accidentally submitted.

Settings targets identify the Settings Owner rather than the entry source. AP and DB resources are initial Settings Owners, with room for future owners such as Project; Public Addresses is not a Settings Owner, so AP Public Access Node selection opens the associated AP settings target with a Public Addresses view.

The route model should move directly to a unified settings side entry such as `settings:<owner-target>[:view]` and should not preserve the old settings side URL forms. Unsupported settings targets close the Side Pane and repair URL state, because there is no safe fallback provider.

## Considered Options

- Keep separate `apSettings`, `dbSettings`, `apEnvironmentSettings`, and `publicAddresses` side entries: rejected because Side Pane orchestration would continue to know resource-specific settings modes and section-level variants.
- Make every settings section a first-class Side Pane surface: rejected because sections depend on their Settings Owner, provider-specific draft model, and surrounding settings presentation.
- Let callers pass arbitrary section lists: rejected because named views should express stable product scopes, while arbitrary bundles would expose implementation details and create unclear half-settings surfaces.
- Registry-ize every Side Pane surface now: rejected because settings has a shared provider/view/draft shape, while Project creation, deployment panes, and workflow panes do not yet share that contract.
- Preserve old settings side URL compatibility: rejected because the product is still moving to the slot-based route model and compatibility for old settings pane keys is out of scope.

## Consequences

Project Canvas, assistant actions, and toolbar actions should request `kind: "settings"` with a Settings Owner target and optional view, rather than directly choosing AP or DB pane components. The settings feature becomes the boundary for provider registration, view validation, and settings draft/leave-guard behavior; shared UI packages remain focused on reusable controls and layout primitives rather than AP/DB provider knowledge.

The existing monolithic AP settings pane should be split into provider-local rendered sections as part of this architecture change rather than kept as an opaque pane behind the new host. The host renders shared settings chrome and section layout, while providers return structured section models and section content.

When AP settings are split, do not keep a `ContainerSettingsPane` compatibility layer. Product-owned AP settings sections should move to the AP settings provider boundary in the same change, while shared UI packages retain only reusable settings controls and layout primitives.
