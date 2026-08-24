# Give Canvas Resources Editable Display Names Stored on the Resource

AP and DB names are generated as `ap-`/`db-` plus six random letters and double
as the immutable Kubernetes `metadata.name`, so canvas nodes read as noise
(`ap-xkqjzw`) and can never be renamed. ADR 0058 solved this one level up for
Projects; nothing equivalent existed at the resource layer. A Resource Display
Name (see CONTEXT.md) is display-only — stable identity remains Canvas
Resource Identity (`kind`, `namespace`, `name`).

## Decision

Every AP, DB, and Template Instance carries a Resource Display Name in a
`brain.io/display-name` annotation on the resource object itself (same
`brain.io` domain as the existing project labels). An AP Public Access Node
shows its AP's display name rather than owning one.

- **Default** — derived at deploy time from the Deployment Source through the
  ADR 0058 derivation module (Docker image segment, DB engine, template name)
  and written into the annotation, unique within the Project with an
  incrementing suffix (`nginx`, `nginx-2`). Reading never derives: a resource
  without the annotation (created before this feature, or by a writer that
  does not stamp names yet) shows its Kubernetes name — exactly what it
  displayed before this feature — until the user renames it. A display name
  is either written on the resource or it is the Kubernetes name.
- **Rename** — the settings pane title is the edit surface; saving patches the
  annotation. Trimmed, 1–256 characters, any script. Submitting an empty name
  is a no-op: there is no clear action, because once a name is stored the only
  visible result of clearing would be exposing the Kubernetes name, which the
  product avoids surfacing outside destructive confirmations and connection
  strings. A duplicate within the
  Project is rejected at submit; enforcement is an application-side check
  (there is no database to index — the cluster is the source of truth), and
  the residual write race is acceptable because a display name is never
  identity.
- **Kubernetes names get meaningful too** — `childResourceName` drops its
  `ap-`/`db-` branches in favor of the existing template branch (slugified
  source prefix + 6 random letters → `nginx-xkqjzw`), so kubectl and
  connection strings roughly match the product name. These names stay
  machine-generated, collision-safe via the suffix, and immutable; existing
  resources keep their old names.
- **Assistant** — the selected-resource context carries the display name; tool
  guidance states a display name is never a valid `name` argument and must be
  resolved to the Kubernetes name first (mirroring the Project tools' "IDs are
  the only valid targets" rule); the resource read path surfaces
  `metadata.annotations` so the model can resolve names itself.
- **Surfaces** — the display name is primary everywhere users read;
  destructive confirmations (delete, lifecycle) additionally show the
  Kubernetes name; connection strings keep the Kubernetes name.

## Considered Options

- **Lazily derive a readable default at read time for unannotated
  resources** — rejected. A derived name looks authoritative but is persisted
  nowhere: read-time derivation cannot number, so two template instances both
  read as `memos`, and the name silently changes when the underlying image or
  labels change. Legacy resources already displayed their Kubernetes names,
  so falling back there regresses nothing — and a writer that forgets the
  annotation now surfaces as a visible machine name instead of a
  plausible-looking unnumbered one.
- **Only make the Kubernetes name meaningful, no display layer** — rejected.
  The Kubernetes name is immutable, so naming would be frozen at creation and
  a rename feature would mean delete-and-recreate; the user explicitly wants
  renaming.
- **Store display names in the platform database, like Project Display
  Names** — rejected. A Project is a platform-owned record, so its name lives
  in the platform's database; a resource's source of truth is the cluster. A
  side table keyed by `kind:namespace:name` would orphan rows on cluster-side
  deletes and need reconciliation, while an annotation travels with the
  object, disappears with it, and is readable by kubectl and the assistant's
  resource tools for free.
- **Customizable Platform Address host labels** — out of scope. The public
  hostname prefix is validated to exactly six random letters and is an
  outward-facing contract; deliberately not tracked as an issue either.
