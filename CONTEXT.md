# Domain Context

## Ubiquitous Language

### Component Registry

An internal catalog for reusable UI components in the product design system. It is not a catalog for complete product surfaces, panes, or workflows.

### Registry Component

A reusable UI component eligible for the Component Registry. A Registry Component may carry product vocabulary, but it must be driven by a host surface and must not own a complete product workflow or settings lifecycle.

_Avoid_: Product Surface Registry, Pane Registry, Flow Registry.

### Product Tooltip

A transient, non-interactive hint used by the product design system for compact controls or labels. Product Tooltip does not include browser title hints, chart data callouts, or editor/autocomplete overlays.

_Avoid_: All tooltip, native title tooltip, chart tooltip.

### AP Public Access Node

An AP Public Access Node is a presentation-only Project Canvas node derived from an AP's Public Addresses. It is not a Brain product resource, backend API view, Kubernetes resource, or Settings Owner.

The node represents AP-owned public access, including pending Platform Addresses and Custom Domains; its user-visible label is Public access.

_Avoid_: EntryPoint, EntryPoint resource, EntryPoint API view, AP endpoints, Ingress.

### App Listening Port

An AP container port where the application accepts traffic. Each AP has one or more App Listening Ports, identified by their unique port number within the AP. Each App Listening Port has one Private Address and may be targeted by zero or more Public Addresses. Creating a Public Address for a new target port initially adds an App Listening Port for that port, but the App Listening Port may later be removed without deleting the Public Address as long as at least one App Listening Port remains.

### Private Address

A cluster-internal URL for an AP, derived from one App Listening Port. An AP may have multiple Private Addresses when it exposes multiple App Listening Ports; once an App Listening Port exists, its Private Address is known and should not be modeled as pending.

### Public Address

An externally reachable URL/domain alias for an AP that declares a target port. It reaches the App Listening Port for that port when one exists, and editing that target port is Public Address editing rather than Custom Domain Binding.

### Platform Address

A system-assigned Public Address that the platform can create without user DNS or certificate setup; in v1, users request one by choosing an App Listening Port, not by providing a host or URL. A Platform Address may be promoted into the CNAME target for a Custom Domain Binding, after which its host remains the binding target rather than the primary displayed Public Address.

Platform Address health is based on whether the AP's platform routing support matches the AP's Public Address intent and target App Listening Port. It does not require a separately reported load balancer address before the Platform Address can be considered accessible.

### Requested Platform Address

A v1 Platform Address desired entry in AP `spec.input.network.platformAddresses[]`. It has a stable Platform Address ID and target App Listening Port, but no platform-allocated host or URL yet.

### Allocated Platform Address

A Platform Address whose host and URL have been assigned by the platform and published through AP observed network state.

### Reachable Public Address

A Public Address whose allocated host resolves and successfully routes external traffic to the target App Listening Port. Business-level HTTP errors from the workload do not make the Public Address unreachable; a missing target App Listening Port, DNS failure, TLS/connectivity failure, or routing to the wrong backend does.

### AP Public Access Health

An AP-owned read-side assessment of each Public Address's public routing readiness and reachability. It is routing health rather than application response monitoring: workload HTTP 404 or 500 responses do not make a Public Address unhealthy.

AP Settings and the AP Public Access Node may present AP Public Access Health, but it does not belong to a separate EntryPoint, AP Public Access Node, or independent public access resource.

An AP with no Public Address intent has no AP Public Access Health entries; this is absence of public access, not a blocked or unconfigured health state.

_Avoid_: EntryPoint health, AP Public Access Node health, standalone public access monitor.

### AP Public Access Health Status

The AP-owned public routing health state for a Public Address: `progressing`, `verifying`, `accessible`, or `blocked`. `Pending` is legacy-compatible wording, not the canonical health status.

_Avoid_: Pending Public Address health, EntryPoint status, node status.

### Custom Domain

A user-owned Public Address for an AP. A Custom Domain reaches an App Listening Port through a Custom Domain Binding.

Custom Domain health uses `verifying` while DNS ownership, certificate readiness, or routing readiness is still being established. It becomes `blocked` only when the binding is known not to be able to proceed without a changed user or platform action.

### Routing Scope

The public routing boundary within which one Custom Domain can belong to only one AP. In v1, the enforceable Routing Scope is the current Kubernetes namespace; broader cluster-wide uniqueness requires platform-level admission or indexing.

### AP (Application)

A Brain product resource and API view that represents an application workload. `apiVersion: brain.io/direct`, `kind: AP` is a product manifest accepted by the Brain Go API, not a Kubernetes API resource or CRD. The Go API renders AP desired state into underlying Kubernetes resources such as Deployment or StatefulSet, Service, optional Ingress, HPA, Secret, and ConfigMap. AP owns compute, App Listening Ports, Private Addresses, and Platform Address allocation requests.

### AP Settings

The primary UI surface for viewing and editing AP desired configuration, including image, resource capacity, Replica Strategy, environment, and network settings.

### Settings View

A settings entry point that presents one named subset of a resource's settings surface, containing one or more settings sections rather than necessarily showing the full settings surface. It remains part of that resource's settings surface and uses the same Settings Draft confirmation model as the full surface.

_Avoid_: Standalone Settings Section Pane, Section Pane, arbitrary section bundle.

### Settings Section

A coherent subset of a Settings Owner's configuration shown inside a Settings View. Settings Sections belong to their Settings Owner's settings surface and are not standalone panes, Component Registry items, or caller-selected arbitrary bundles.

_Avoid_: Registry Component, product workflow, standalone settings pane.

### Settings Owner

The resource whose desired configuration is edited by a settings surface. AP and DB resources can be Settings Owners; selecting an AP Public Access Node may open an AP-owned Settings View, but the AP Public Access Node is not the Settings Owner.

_Avoid_: EntryPoint Settings Owner, Public Access Node Settings Owner.

### AP Environment Settings Focus

A Settings View that presents only the Environment Variables section for one AP. It is used for AP environment-specific work, including authoring Database Bindings, and is not a separate Database Binding surface.

_Avoid_: Database Binding Pane, AP-DB Binding Pane.

### AP Deployments Pane

A Canvas Resource Pane surface for one existing AP that presents image update controls and retained AP image versions for rollback. It is distinct from Docker Deployment Settings, which are creation-time choices before an AP exists.

_Avoid_: AP Deployment Pane, Image & Entrypoint.

### AP Workload Events

A read-only Canvas Resource Pane opened from a Container Node to inspect recent workload lifecycle events for one AP, such as scheduling, startup, image pull, and health check events.

_Avoid_: AP node events.

### Docker Deployment Settings

The creation-time choices for a new AP before the AP exists, including Docker image, runtime environment variables, App Listening Port, and whether to request a Platform Address. Docker Deployment Settings create an AP workload from an existing image, are independent of entry path, and should use Public Address or Network language rather than Ingress language in user-facing surfaces.

### Deployment Task

A deploy workflow work unit for creating or changing Project resources from a Deployment Source into a Deployment Target. A Deployment Task has one Deployment Runner and may produce Deployment Artifacts.

_Avoid_: GitHub task, deploy job, deployment request.

A Deployment Task is owned by the deployment domain, not by the Project Assistant Pane or any Chat thread. Chat may create, inspect, or explain a Deployment Task through tools, but the task's lifecycle, events, artifacts, and runner transcript remain deployment records.

### Deployment Placeholder Node

A temporary, generic Project Canvas skeleton node that represents one active Deployment Task expected to add resources to its resolved Deployment Target Project. It is a task projection, not an AP, DB, AP Public Access Node, template workload, Settings Owner, resource action target, or Canvas Connection endpoint.

A Deployment Placeholder Node may have project-scoped temporary placement while visible, but durable Canvas Layout belongs to resulting resource nodes after handoff.

_Avoid_: ghost node, pending node, pending AP, fake resource node.

### Deployment Task Projection

A Project-scoped read-side view of one Deployment Task containing only the facts needed by project surfaces to present deployment progress and resource handoff. It is distinct from the Deployment Task record, task event log, runner transcript, and resulting AP, DB, or template workload state.

Project Canvas consumes Deployment Task Projections rather than full Deployment Task records when rendering Deployment Placeholder Nodes and Deployment Handoff.

_Avoid_: task list row, canvas task, placeholder source data.

### Primary Deployment Result

The resulting canvas resource node that inherits the Deployment Placeholder Node's visual position when a Deployment Task produces multiple resources. AP results are primary before DB results, template-native workload results are primary only when no AP or DB result exists, and AP Public Access Nodes are never the Primary Deployment Result.

_Avoid_: main ghost target, first applied YAML, primary public access.

### Deployment Handoff

The transition where a completed Deployment Task stops being represented by a Deployment Placeholder Node and its Primary Deployment Result appears as a normal Project Canvas resource node. Deployment Handoff may carry the placeholder's temporary position to the Primary Deployment Result when that resource has no existing Canvas Layout position.

_Avoid_: completed placeholder, ghost replacement, result takeover.

### Deployment Source

The user-provided origin or intent for a Deployment Task, such as a GitHub repository, Docker image, database choice, application template, or natural-language deployment prompt. A Deployment Source describes what should be deployed, not where it should land.

_Avoid_: deploy input, entry path, creation method.

### Deployment Target

The Project relationship selected before a Deployment Task starts. A Deployment Target is either a new Project being created in the same flow or an existing Project that will receive the deployed resources.

_Avoid_: GitHub Deployment Target, Docker Deployment Target, project selector.

### Deployment Runner

The execution strategy for one Deployment Task. Direct and template runners use already-structured Deployment Sources, while an AI Runner interprets less-structured sources such as repositories or natural-language prompts.

_Avoid_: task type, deploy engine.

### Deployment Artifact

A product resource description produced or selected by a Deployment Task for application into the Deployment Target. Deployment Artifacts are distinct from Deployment Source details and task progress messages.

_Avoid_: task output, generated file.

### Docker Deployment Target

The source-specific wording for the Deployment Target used with Docker Deployment Settings.

### GitHub Deployment Target

The source-specific wording for the Deployment Target used with a GitHub repository Deployment Source.

### Public Access Panel

A narrow UI surface opened from an AP Public Access Node selection that presents the associated AP's Public Addresses. It is scoped to public access and is not the full AP Settings surface.

The panel is a Settings View for the associated AP's Public Addresses, even though it opens from a presentation-only canvas node.

The panel can open for an AP Public Access Node before allocated routing data exists, because the user's public access intent belongs to the associated AP's Public Addresses. It includes Platform Address rows and Custom Domain rows, and does not present the AP's Private Address.

Edits made from the panel use the same Settings Draft confirmation model as AP Settings.

The panel title is anchored on the associated AP name, even when no Public Address has allocated host data yet.

After the last Public Address is removed, the panel may remain open as an AP-bound Public Addresses settings surface even though the AP Public Access Node disappears from the canvas.

The panel closes when the associated AP no longer exists.

When no Public Addresses remain, the panel shows an empty state and still allows adding a Public Address. Public Address behavior in this panel matches AP Settings Public Address behavior.

### AP Replica Strategy

The AP configuration choice for how many workload replicas should run: either a fixed user-selected count or Elastic Scaling within user-selected bounds.

### Fixed Replicas

An AP Replica Strategy where the user selects one desired replica count and the platform keeps the AP at that count.

### Elastic Scaling

An AP Replica Strategy where the platform automatically adjusts AP replicas between a user-selected minimum and maximum based on one selected resource utilization target.

### DB (Database)

A Brain product resource and API view that represents a managed database workload available to APs in the same Project. `apiVersion: brain.io/direct`, `kind: DB` is a product manifest accepted by the Brain Go API, not a Kubernetes API resource or CRD. The Go API renders DB desired state into underlying KubeBlocks and Kubernetes resources such as Cluster, Service, credentials, backup resources, and lifecycle OpsRequests.

### DB Service

The user-facing database service represented by one DB resource and one database node on the Project Canvas. A DB Service may expose multiple engine-level Logical Databases through DB Access.

### DB Service Backup

A named recovery point for an entire DB Service, optionally annotated with a short description. The backup name is the backup's user-visible identity, while the description is non-identifying context. A DB Service Backup is either manual or automatic; automatic DB Service Backups are created by the DB Service Backup Policy. A DB Service Backup belongs to the DB Service rather than to one Logical Database, schema, table, collection, or key inside it. Deleting a DB Service Backup removes that recovery point, not the source DB Service or any DB Service already restored from it.

When shown as a recovery point, a DB Service Backup's time represents when the recovery point was started or created, not when the backup job completed.

Manual DB Service Backup creation requires the source DB Service to be running. DB Service Restore requires the selected DB Service Backup to be completed, and backup deletion is unavailable while the backup is still in progress.

### DB Service Backup Policy

The automatic backup rule for one DB Service. A DB Service has at most one current DB Service Backup Policy; the policy is distinct from the DB Service Backups it creates, may run hourly, daily, or weekly using the user's local time, and retains backups for a selected number of days. Disabling the policy stops future automatic backups but does not delete existing DB Service Backups.

### DB Service Restore

The act of creating a new DB Service from a DB Service Backup. A DB Service Restore does not overwrite or roll back the source DB Service; the restored DB Service appears in the same Project Canvas and namespace as the source DB Service. After the restored DB Service appears, it becomes the user's next Project Canvas focus. The restored DB Service inherits the source DB Service's database settings unless the product explicitly offers restore-time overrides.

### Logical Database

An engine-level database namespace exposed inside one DB Service, such as a PostgreSQL database, MySQL database, MongoDB database, or Redis database index. A Logical Database is an object browsed inside DB Access, not a Project Canvas DB resource.

### DB Deployment Settings

The creation-time choices for a new DB before the DB exists, including database engine, instance preset, and replica count. DB Deployment Settings are independent of entry path: they may create a DB together with a new Project or add a DB to an existing Project.

### DB Deployment Target

The Project relationship selected for a DB before creation. A DB Deployment Target is either a new Project being created in the same flow or an existing Project that will own the new DB.

### DB Instance Preset

A user-facing resource-size choice for DB Deployment Settings. Each DB Instance Preset maps to one DB quota value; avoid exposing internal SKU-like labels such as `db.mysql.small` as the primary UI language.

### DB Settings

The primary UI surface for viewing and editing an existing DB's desired configuration after it has been created.

### DB Configuration Draft

A DB-specific Settings Draft retained as legacy wording.

### Settings Draft

A local set of pending AP or DB settings changes that is submitted only when the user confirms a settings update. Discarding a Settings Draft abandons the pending changes and keeps the settings surface open.

_Avoid_: Cancellation, Cancel settings changes, Save settings changes.

### Database Binding

A runtime dependency where an AP is configured to consume one DB's connection credentials.

### Pending Database Binding Intent

An unsaved AP Environment draft intent to create a Database Binding by adding one or more AP Environment References to a DB Service. A Pending Database Binding Intent may be visualized on the Project Canvas as a pending AP-to-DB edge, but it is not a Canvas Connection until the AP environment is updated and the relationship can be detected from saved AP and DB resource state.

A Pending Database Binding Intent is derived from explicit AP Environment References in the current AP Environment draft. Ordinary user-authored DSN strings do not create a Pending Database Binding Intent, even if they happen to equal a DB Service's current DSN; after update, exact saved DSN evidence may still produce an established Canvas Connection.

A Pending Database Binding Intent remains while the current AP Environment draft still contains explicit AP Environment References to the DB Service. It ends when those references are removed from the draft, the Settings Draft is discarded, the user leaves the AP or Project scope, or a successful update lets saved resource state produce the established Canvas Connection. A failed update does not end the intent because the AP Environment draft still exists.

An AP-to-DB Connecting Edge is only a shortcut for opening AP Environment Settings and inserting an AP Environment Reference. Users may also create the same Pending Database Binding Intent directly in the AP Environment editor by authoring an AP Environment Reference.

Multiple AP Environment References from one AP Environment draft to the same DB Service collapse into one Pending Database Binding Intent. References from the same AP Environment draft to different DB Services are separate Pending Database Binding Intents.

A Pending Database Binding Intent does not require a duplicate pending canvas edge when an established AP-to-DB Canvas Connection for the same AP and DB Service already exists.

When an AP Environment Raw Source draft is temporarily invalid while the user is editing, it does not redefine Pending Database Binding Intents. The last valid draft-derived intents remain until the draft becomes valid again, the Settings Draft is discarded, or the user leaves the AP or Project scope.

_Avoid_: Pending edge, hidden binding record, inferred string binding.

### AP Environment Raw Source

The canonical AP environment editing model: the complete set of AP environment entries as the user can author them in `.env` form, including direct values, AP Environment References, and runtime environment expansions. Structured AP Environment controls are views or insertion aids over the AP Environment Raw Source, not separate saved state.

_Avoid_: Hidden binding metadata, editor-only environment language.

### AP Environment Structured View

The preferred default presentation of the AP Environment Raw Source. It recognizes direct values, AP Environment References, composed values, and Database Binding evidence while preserving the underlying raw environment entries; listed values are masked by default and revealed only through explicit user action.

### Reference

A DB Service selected in the AP Environment editor as a source for inserting or recognizing DB-backed environment entries. A Reference is editing context, not saved product state by itself, and is not an independent property of an AP environment row.

_Avoid_: Binding record, hidden binding state.

### AP Environment DB Reference Source

The AP Environment Settings fact that describes one DB Service as a source for AP Environment References, including its DB Service identity, engine, available DSN values, and Secret-backed primitive fields such as host, port, username, and password.

AP Environment DB Reference Sources are derived from DB resource state. They let AP Environment Settings present Database Binding choices and recognize saved DB-derived environment values without exposing the raw DB list payload to Project Canvas Workbench.

AP Environment DB Reference Source is not a Database Binding and is not a Canvas Connection. A Database Binding exists only after AP environment state is saved and can be detected from saved AP and DB resource state; a Canvas Connection is the rendered edge derived from that saved evidence.

### AP Environment Reference

A product-level expression in the AP Environment Raw Source that points at a DB Service-provided environment value. An AP Environment Reference is resolved before runtime into ordinary AP environment entries, while the user-facing raw source may retain the reference expression.

_Avoid_: UI-only token, hidden binding metadata.

### AP Environment Resolved Value

The value produced by resolving an AP Environment Reference or ordinary AP environment entry for user inspection. AP Environment Resolved Values are requested explicitly and are not the default list presentation.

### DB Connection DSN

A complete connection string for one DB Service, including the credentials needed by an application to connect when the DB engine requires credentials.

_Avoid_: Address-only DSN, credential-free DATABASE_URL.

### AP Environment Composed Value

An AP environment value that refers to another AP environment variable at runtime. The referenced variable remains an ordinary AP environment entry in the AP Environment Raw Source.

_Avoid_: AP Environment Reference Token, AP Environment Helper Variable.

### DB Access

A resource workflow for inspecting, and when the product enables it editing, one DB Service's objects and data without exposing its connection credentials. DB Access is distinct from DB Settings: DB Settings changes a DB's desired configuration, while DB Access works with the Logical Databases and objects exposed by that DB Service.

_Avoid_: Data Browser, database browser.

### DB Access Session

One active DB Access browsing session for a single DB Service. A DB Access Session keeps object selection and open object tabs while browsing multiple Logical Databases within that DB Service, while closing DB Access or switching to a different DB Service starts a separate session.

### DB Terminal

An interactive terminal session that runs a DB Service's native engine client — such as `psql`, `mysql`, `mongosh`, or `redis-cli` — for ad-hoc, read-write commands against that DB Service. A DB Terminal is distinct from DB Access: DB Access is a structured object and data workflow, while a DB Terminal is a full interactive engine-client session. It is offered only for engines that ship a supported client and only while the DB Service is running.

_Avoid_: DB Console, console.

### AP Terminal

An interactive terminal session that opens a generic pod shell on an AP workload. An AP Terminal is distinct from a DB Terminal: both are terminals in the UI, but an AP Terminal is a workload shell while a DB Terminal is a database engine-client session.

_Avoid_: AP Console, console.

### Session Drawer

A bottom temporary project surface for one interactive resource session, such as an AP Terminal or DB Terminal. A Session Drawer is distinct from a Side Pane and may remain open while the user inspects resource details in a Side Pane.

Within one project surface, Session Drawer is single-active. A Session Drawer may coexist with a Side Pane or Main Action Surface, and it remains pinned to its session target rather than following canvas selection.

### Container Node

A canvas node that represents an AP workload. The name is retained as a product/UI term, but it does not mean an individual Kubernetes container.

### Canvas Layout

A Project-scoped visual arrangement of the canvas, shared by everyone who opens that Project.

### Generated Canvas Position

A deterministic placement proposed for a canvas node that does not yet have a Canvas Layout position. Once accepted by Incremental Canvas Placement, it becomes part of Canvas Layout for that node.

_Avoid_: recalculating a Generated Canvas Position for a node that already has a Canvas Layout position.

### Incremental Canvas Placement

A canvas placement rule that assigns positions only to canvas nodes without a Canvas Layout position. It preserves existing Canvas Layout positions and does not reinterpret user-arranged canvas structure when resources appear, disappear, or reconcile.

When Incremental Canvas Placement accepts a Generated Canvas Position, the placement save is scoped to the newly placed node or Canvas Placement Group rather than rewriting unrelated Canvas Layout nodes.

_Avoid_: using Incremental Canvas Placement to describe whole-canvas auto-layout.

### Canvas Placement Anchor

An existing canvas node or relationship fact used as the local reference for placing a canvas node that does not yet have a Canvas Layout position.

Incremental Canvas Placement prefers Canvas Placement Anchors that reflect resource relationships before using global open canvas space.

### Canvas Placement Anchor Strength

The relative priority of possible Canvas Placement Anchors when a node has more than one meaningful local reference. User-initiated workflow context is stronger than passively discovered resource relationships.

Incremental Canvas Placement may evaluate more than one Canvas Placement Anchor in strength order before using Global Canvas Placement Blocks.

### Canvas Placement Direction Preference

A preferred side or nearby pattern for placing a canvas node around a Canvas Placement Anchor. Direction preferences make resource relationships easier to read, but they do not permit canvas node overlap.

_Avoid_: treating a Canvas Placement Direction Preference as a hard coordinate.

### Canvas Node Footprint

The stable placement rectangle reserved for a canvas node when checking whether Generated Canvas Positions overlap. A Canvas Node Footprint is based on node type and layout-relevant presentation state rather than on transient DOM measurement.

Canvas Node Expansion State affects Canvas Node Footprint when the expansion state is saved or otherwise explicit in the current canvas state.

### Canvas Placement Occupancy

The set of Canvas Node Footprints treated as unavailable while Incremental Canvas Placement assigns Generated Canvas Positions. Canvas Placement Occupancy includes existing Canvas Layout nodes and Generated Canvas Positions already assigned in the same placement pass.

Recently orphaned Canvas Layout nodes may remain in Canvas Placement Occupancy during their retention window. Expired orphaned layout nodes do not reserve placement space.

### Global Canvas Placement Block

A bounded group of candidate positions used when Incremental Canvas Placement cannot find a Canvas Placement Anchor for a new node. Global Canvas Placement Blocks expand around the existing canvas structure in a deterministic order instead of filling arbitrary holes or growing indefinitely in one direction.

### Anchor-Local Canvas Placement Block

A bounded group of candidate positions around a Canvas Placement Anchor. Anchor-Local Canvas Placement Blocks use Canvas Placement Direction Preferences to order nearby candidates while still respecting Canvas Placement Occupancy.

### Canvas Placement Group

A set of new canvas nodes that Incremental Canvas Placement positions together because they come from one user workflow or have direct resource relationship evidence. A Canvas Placement Group is not defined merely by appearing in the same resource refresh.

Canvas Placement Groups are evaluated against Canvas Placement Occupancy as a whole so related new nodes remain near one another when they first appear.

An AP with desired Public Address intent and its AP Public Access Node form a Canvas Placement Group while neither node has a Canvas Layout position. The AP is the group's primary resource node, and the AP Public Access Node is a presentation node for AP-owned public access rather than an independent resource.

After first placement, Canvas Placement Group membership does not imply that later user movement of one node moves the other nodes.

### Canvas Viewport Focus

A temporary, per-view adjustment of the Project Canvas viewport that keeps a target canvas node visible within the currently available canvas area without changing Canvas Layout.

_Avoid_: using Canvas Layout to describe temporary viewport movement.

### Canvas Pointer Mode

The Project Canvas interaction mode for selecting resources, opening resource-scoped surfaces, moving canvas nodes, and starting Connecting Edge gestures.

Canvas Pointer Mode may change Canvas Layout when a canvas node is moved, depending on the Project Canvas read/write state. It is distinct from Canvas Viewport movement, which changes only the user's current view. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas Hand Mode

The Project Canvas interaction mode for browsing the canvas by moving the viewport without selecting resources, using resource quick actions, opening resource-scoped surfaces, moving canvas nodes, or starting Connecting Edge gestures.

Canvas Hand Mode preserves the current canvas selection and active project surfaces, and does not change Canvas Layout. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas MiniMap

A Project Canvas navigation aid that shows the relationship between the current viewport and the overall Canvas Layout.

Canvas MiniMap changes only the current viewport. It does not select resources, open project surfaces, move canvas nodes, or create Canvas Connections.

### Canvas Viewport Control

A Project Canvas control that changes the current user's canvas viewport, such as fitting the visible graph or adjusting zoom.

Canvas Viewport Controls are not persisted in Canvas Layout and do not affect other users' view of the Project Canvas.

### Canvas Navigation Chrome

The normally hidden, transient Project Canvas navigation UI around the graph, including Canvas MiniMap and Canvas Viewport Controls.

Canvas Navigation Chrome appears during canvas navigation or node movement and briefly remains visible after the interaction ends. It is session-local and does not change Canvas Layout.

Pointer hover alone is not canvas navigation and does not reveal Canvas Navigation Chrome. Resource selection, resource inspection, or Connecting Edge gestures do not reveal Canvas Navigation Chrome. Keyboard shortcuts for canvas interaction or viewport changes do reveal Canvas Navigation Chrome. Programmatic viewport movement does not reveal Canvas Navigation Chrome. Once revealed by canvas navigation or node movement, direct pointer or keyboard focus interaction with Canvas Navigation Chrome keeps it visible and visible to the user. When hidden, Canvas Navigation Chrome does not participate in canvas interaction, and no separate persistent mode indicator replaces it. Open project surfaces such as Side Pane, Main Action Surface, or Session Drawer do not suppress Canvas Navigation Chrome.

### Canvas Resource Identity

The product identity of a canvas node's backing AP, DB, or AP Public Access Node surface. Canvas Resource Identity is keyed by `kind`, `namespace`, and `name`, which keeps Canvas Layout stable across short reconciliation gaps.

For AP and DB nodes, `name` is the product resource name and also the primary underlying workload or Cluster name used by the Brain renderer. For AP Public Access Nodes, `name` is the associated AP name: the node represents that AP's Public Addresses surface, including pending allocation state.

Underlying Kubernetes UID is retained separately as the last-seen entity identity where available so the UI can detect when a same-named AP workload or DB Cluster is meaningfully new. AP Public Access Nodes use AP-bound identity and observed public access facts rather than their own Kubernetes UID.

### AP-bound Surface Key

The public access selection identity used by URL state and the Canvas Resource Pane. An AP-bound Surface Key is stable for `{ namespace, apName }` and selects the AP's Public Addresses surface, whether allocated routing data already exists or is still pending.

The AP-bound Surface Key is not the same thing as the Canvas Layout resource key. Canvas Layout uses Canvas Resource Identity. URL and pane selection may derive an AP-bound Surface Key from the same AP Public Access Node facts, but the two keys are not interchangeable.

### Canvas Node Expansion State

The per-node expanded or collapsed presentation state of a canvas node card.

### Canvas Node Stack Order

The per-node visual layering order used when canvas node cards overlap.

### Canvas Connection

A canvas edge that represents an established runtime dependency between resources.

Canvas Connections are derived from saved resource state. Removing Database Binding evidence in an unsaved AP Environment draft does not remove or hide the established AP-to-DB Canvas Connection before the AP environment update succeeds.

### Canvas Resource Pane

A right-side canvas surface opened from a selected AP or DB node to inspect or change resource-scoped details such as settings, metrics, or history. It is distinct from the project assistant chat pane.

### Project Canvas Resource Snapshot

The Project-scoped resource facts used to render one Project Canvas, derived from AP, DB, AP Public Access Node, and template-native workload list state plus the current Canvas Layout.

A Project Canvas Resource Snapshot determines Canvas nodes, Canvas Connections, empty/loading/error frame state, resource refresh policy, and Canvas Layout save intent such as first placement or layout merge. It may include Deployment Placeholder Nodes from active Deployment Task records, but it does not own Canvas Layout persistence; it emits layout intent for the Canvas Layout save pipeline to persist.

Downstream Project Canvas modules should consume canvas-ready resource facts from a Project Canvas Resource Snapshot rather than raw AP, DB, AP Public Access Node, or workload list payloads. For example, DB reference sources for AP Environment References are Project Canvas Resource Snapshot facts, while the raw DB list payload remains internal implementation detail.

Project Canvas Resource Snapshot is distinct from Workload Telemetry Snapshot: resource snapshot data determines whether resources and Canvas Connections exist, while telemetry snapshot data only decorates already-known AP and DB nodes with current usage metrics.

### Project Canvas Workbench

The client-side module that owns Project Canvas presentation and Project Canvas-specific interactions for one Project surface, including canvas node decoration, Canvas Resource Pane rendering, Main Action Surface and Session Drawer rendering for canvas-triggered resource work, Canvas Connection gestures, and Canvas Node Stack Order behavior.

Project Canvas Workbench consumes project-level surface state but does not own the Project Surface model itself. Project Surface slots such as Side Pane, Main Action Surface, and Session Drawer remain project-level concepts so assistant chat, toolbar actions, and future project surfaces can open them without depending on canvas-specific selection behavior.

### Project Canvas Command Model

The Project Canvas Workbench decision model that turns canvas-originated user intents into workbench-level command plans. Inputs include selected canvas nodes, node quick actions, Connecting Edges, read-only state, and current Canvas Resource Identity facts.

A Project Canvas Command Model plan may request a Canvas selection change, Side Pane opening, Main Action Surface opening, Session Drawer opening, Canvas Node Stack Order change, pending Database Binding intent, or discard/feedback reason.

The Project Canvas Command Model does not execute Kubernetes lifecycle mutations directly. Lifecycle mutation adapters handle authentication, K8s calls, toast feedback, and workload list refresh after a command plan has selected the relevant resource action.

### Main Action Surface

A temporary project surface opened for focused resource work, occupying the project main area rather than the Project Assistant Pane. A Main Action Surface is distinct from a Side Pane because it is not a right-side inspection surface and may host different action-specific experiences over time.

Within one project surface, a Main Action Surface is single-active: opening one Main Action Surface replaces the currently open Main Action Surface instead of stacking multiple main-area surfaces.

A Main Action Surface usually takes focus over the Side Pane in the same project surface rather than presenting both as competing focused work surfaces.

A Main Action Surface follows the project main area's available width when the Project Assistant Pane is opened or closed.

### Side Pane

A non-modal, right-side temporary surface opened over the project main area to host focused project work. Side Panes share the same chrome and close behavior while their contents differ by purpose, such as Project creation, GitHub deployment, or Canvas Resource details.

A Side Pane is distinct from the Project Assistant Pane: the Project Assistant Pane is a persistent layout region for chat, while a Side Pane is a temporary surface triggered by a user action or assistant action.

Within one project surface, Side Pane is single-active: opening one Side Pane replaces the currently open Side Pane instead of stacking multiple Side Panes.

Different project surfaces may place a Side Pane differently. A canvas-oriented surface may overlay the Side Pane above the canvas, while a list-oriented surface may reserve layout space for the Side Pane. Placement does not change the Side Pane's shared chrome, close behavior, or single-active semantics.

A Side Pane is scoped to the currently visible project surface. Project Assistant Pane controls can open or replace the current surface's active Side Pane, but they do not own a separate assistant-specific Side Pane stack.

When a Side Pane contains unsaved user edits, closing it, replacing it with another Side Pane, or opening a focused Main Action Surface that hides it must first resolve the edit state. The user can stay on the current Side Pane, discard the edits, or save successfully before the Side Pane closes, is replaced, or is hidden by the focused surface.

### Project Assistant Pane

The persistent right-side project layout region that hosts assistant chat and related chat controls. It can trigger Side Panes, but is not itself a Side Pane.

### Connecting Edge

A temporary canvas interaction created when a user drags a line between canvas nodes. A Connecting Edge may become a domain command only when its endpoints match a supported resource relationship, regardless of drag direction.

### Workload Telemetry Series

A normalized time-series representation of workload resource usage for AP and DB workloads. It is consumed by both compact canvas node summaries and detailed metrics panels.

### Resource Logs

A read-only Main Action Surface for inspecting timestamped runtime output emitted by one AP or DB Service. Resource Logs cover both AP and DB Service resources, default to the most recent hour, refresh only from explicit user/query changes, and are for recent/historical observation rather than an interactive command surface like the AP Terminal or DB Terminal.

### Project Aggregate Status

A derived health tone for one Project row in the project list, computed from the phases of the Project's APs and DBs. It is not a persisted field on the Project product record; it is computed from sibling workload lists. It expresses "are the workloads inside this project healthy", which is what users look at on the list, and is distinct from whether the Project record itself exists.

### Project Display Name

The human-facing Project name shown in navigation, project chrome, project creation forms, and human confirmation prompts. It is stored on the Brain Project product record and is unique within a namespace after trimming surrounding whitespace and comparing case-insensitively. Avoid using Project name as a selector; stable identity uses Project ID.

### Project Creation Pane

A non-modal right-side surface anchored in the project main pane for entering a new Project's initial user-facing identity and choosing how to create it before the Project product record exists. It is distinct from the Canvas Resource Pane and may coexist with the project assistant chat pane.

The Project Creation Pane may also open in a source-specific entry path. In a GitHub direct creation path, the user starts at GitHub repository selection rather than the general creation picker; the Project Display Name is derived from the selected repository and de-duplicated within the namespace. In a Docker direct creation path, the Project Display Name is derived from the Docker image repository name and de-duplicated within the namespace.

### Custom Domain Binding

The relationship that attaches a Custom Domain to an AP by promoting one Platform Address as the CNAME target. The AP owns the user's binding intent and public access health; the AP Public Access Node only presents that AP-owned public access state on the canvas.

A Custom Domain Binding targets the App Listening Port selected on the promoted Platform Address. Binding a Custom Domain may also retarget that promoted Platform Address to a different App Listening Port.

Unbinding a Custom Domain removes that relationship and returns the promoted Platform Address to ordinary display; it does not delete the Platform Address or close public access.

### CNAME Verification Evidence

The remembered fact that a Custom Domain pointed to the promoted Platform Address when the Custom Domain Binding was submitted. It belongs to the Custom Domain Binding intent lifecycle and is not ongoing DNS monitoring.
