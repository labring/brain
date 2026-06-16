# Domain Context

## Ubiquitous Language

### Component Registry

An internal catalog for reusable UI components in the product design system. It is not a catalog for complete product surfaces, panes, or workflows.

### Registry Component

A reusable UI component eligible for the Component Registry. A Registry Component may carry product vocabulary, but it must be driven by a host surface and must not own a complete product workflow or settings lifecycle.

_Avoid_: Product Surface Registry, Pane Registry, Flow Registry.

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

A system-assigned Public Address that the platform can create without user DNS or certificate setup. Users request one by choosing an App Listening Port rather than providing a host or URL; its host may be pending until the platform allocates it. A Platform Address may be promoted into the CNAME target for a Custom Domain Binding, after which its host remains the binding target rather than the primary displayed Public Address.

Platform Address health is based on whether the AP's platform routing support matches the AP's Public Address intent and target App Listening Port. It does not require a separately reported load balancer address before the Platform Address can be considered accessible.

### AP Public Access Health

An AP-owned read-side assessment of each Public Address's public routing readiness and reachability, using routing states such as `progressing`, `verifying`, `accessible`, and `blocked`. It is routing health rather than application response monitoring: workload HTTP 404 or 500 responses do not make a Public Address unhealthy.

AP Settings and the AP Public Access Node may present AP Public Access Health, but it does not belong to a separate EntryPoint, AP Public Access Node, or independent public access resource.

An AP with no Public Address intent has no AP Public Access Health entries; this is absence of public access, not a blocked or unconfigured health state.

_Avoid_: EntryPoint health, AP Public Access Node health, standalone public access monitor.

### Custom Domain

A user-owned Public Address for an AP. A Custom Domain reaches an App Listening Port through a Custom Domain Binding.

Custom Domain health uses `verifying` while DNS ownership, certificate readiness, or routing readiness is still being established. It becomes `blocked` only when the binding is known not to be able to proceed without a changed user or platform action.

### Routing Scope

The public routing boundary within which one Custom Domain can belong to only one AP. In v1, the enforceable Routing Scope is the current Kubernetes namespace; broader cluster-wide uniqueness requires platform-level admission or indexing.

### AP (Application)

A Brain product resource that represents an application workload. AP owns the application's desired compute, environment, App Listening Ports, Private Addresses, and Platform Address allocation requests.

### AP Settings

The primary UI surface for viewing and editing AP desired configuration, including image, resource capacity, Replica Strategy, environment, and network settings.

### AP Network Settings

The AP-owned settings area for App Listening Ports, Private Addresses, Public Addresses, Platform Addresses, and Custom Domain Bindings. Private Addresses and Public Addresses are two views of the same AP Network Settings: Public Address changes may add App Listening Ports as part of the same Settings Draft.

AP Network Settings may appear inside the full AP Settings surface or a narrower Settings View, but they remain one AP Settings Draft domain rather than settings owned by an AP Public Access Node.

### Settings View

A settings entry point that presents one named subset of a resource's settings surface, containing one or more settings sections rather than necessarily showing the full settings surface. It remains part of that resource's settings surface and uses the same Settings Draft confirmation model as the full surface.

_Avoid_: Standalone Settings Section Pane, Section Pane, arbitrary section bundle.

### Settings Section

A coherent subset of a Settings Owner's configuration shown inside a Settings View. Settings Sections belong to their Settings Owner's settings surface and are not standalone panes, Component Registry items, or caller-selected arbitrary bundles.

_Avoid_: Registry Component, product workflow, standalone settings pane.

### Settings Owner

The resource whose desired configuration is edited by a settings surface. AP and DB resources can be Settings Owners; selecting an AP Public Access Node may open an AP-owned Settings View, but the AP Public Access Node is not the Settings Owner.

_Avoid_: EntryPoint Settings Owner, Public Access Node Settings Owner.

### Docker Deployment Settings

The creation-time choices for a new AP before the AP exists, including Docker image, runtime environment variables, App Listening Port, and whether to request a Platform Address. Docker Deployment Settings create an AP workload from an existing image, are independent of entry path, and should use Public Address or Network language rather than Ingress language in user-facing surfaces.

### Deployment Task

A deploy workflow work unit for creating or changing Project resources from a Deployment Source into a Deployment Target. A Deployment Task has one Deployment Runner and may produce Deployment Artifacts.

_Avoid_: GitHub task, deploy job, deployment request.

A Deployment Task is owned by the deployment domain, not by the Project Assistant Pane or any Chat thread. Chat may create, inspect, or explain a Deployment Task through tools, but the task's lifecycle, events, artifacts, and runner transcript remain deployment records.

### Deployment Projection Slot

A task-local Project Canvas slot within one Deployment Task Projection. An unknown Deployment Projection Slot represents deployment progress before structured result evidence exists; a concrete slot may carry the anticipated result identity used for Deployment Handoff, but it is not a Canvas Resource Identity.

An unknown Deployment Projection Slot uses a stable unknown slot identity within its Deployment Task. A concrete Deployment Projection Slot uses an identity derived from its anticipated result reference, while the Canvas Placement Owner combines that slot identity with the Deployment Task identity.

Deployment Projection Slots are only for anticipated results that can become Project Canvas resource nodes. Template support objects may inform deployment progress, but they are not Deployment Projection Slots.

_Avoid_: generic placeholder identity, result-only slot, pending resource identity, fake Canvas Resource Identity, one slot per applied Kubernetes object.

### Deployment Placeholder Node

A temporary Project Canvas skeleton node rendered for a Deployment Projection Slot that does not have a live resource node. It is a task projection, not an AP, DB, AP Public Access Node, template workload, Settings Owner, resource action target, or Canvas Connection endpoint.

_Avoid_: ghost node, pending node, pending AP, pending DB, fake resource node.

### Deployment Projection Placement

The project-scoped temporary visual position owned by a Deployment Projection Slot before Deployment Handoff. Deployment Projection Placement is a Canvas Layout placement owned by the deployment projection, and it may be rekeyed to a resulting resource when handoff occurs.

_Avoid_: pending node layout, fake resource layout, viewport placement.

### Deployment Preview Edge

A temporary visual relationship between Deployment Projection Slots in one Deployment Task Projection. It is not a Canvas Connection and does not represent an established runtime dependency.

Deployment Preview Edges require explicit preview facts, such as generated AP-to-DB reference intent, template-declared dependency, or AP-to-Public-Access presentation relationship. Sharing one Deployment Task is not enough to create a Deployment Preview Edge.

_Avoid_: pending connection, fake edge, draft Canvas Connection.

### Deployment Task Projection

A Project-scoped read-side view of one Deployment Task containing only the facts needed by project surfaces to present deployment progress and resource handoff. It contains one or more Deployment Projection Slots and Deployment Preview Edges, but it does not own Canvas Layout positions.

Project Canvas consumes Deployment Task Projections rather than full Deployment Task records when rendering Deployment Placeholder Nodes and Deployment Handoff.

_Avoid_: task list row, canvas task, placeholder source data.

### Deployment Handoff

The transition where a concrete Deployment Projection Slot stops being represented by a Deployment Placeholder Node and its matching result appears as a normal Project Canvas resource node. Deployment Handoff may rekey the slot's Deployment Projection Placement to the resulting resource when that resource has no existing Canvas Layout position.

Deployment Handoff may complete per slot while unresolved slots remain visible as Deployment Placeholder Nodes.

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

### AP Replica Strategy

The AP configuration choice for how many workload replicas should run: either a fixed user-selected count or Elastic Scaling within user-selected bounds.

### Fixed Replicas

An AP Replica Strategy where the user selects one desired replica count and the platform keeps the AP at that count.

### Elastic Scaling

An AP Replica Strategy where the platform automatically adjusts AP replicas between a user-selected minimum and maximum based on one selected resource utilization target.

### DB (Database)

A Brain product resource that represents a managed database workload available to APs in the same Project.

### DB Service

The user-facing database service represented by one DB resource and one database node on the Project Canvas. A DB Service may expose multiple engine-level Logical Databases through DB Access.

### DB Service Backup

A named recovery point for an entire DB Service. A DB Service Backup may be manual or automatic, belongs to the DB Service rather than to one Logical Database or object inside it, and can be used for DB Service Restore after it completes. Deleting a DB Service Backup removes only that recovery point, not the source DB Service or any DB Service restored from it.

### DB Service Backup Policy

The automatic backup rule for one DB Service. A DB Service has at most one current DB Service Backup Policy; the policy is distinct from the DB Service Backups it creates and defines their schedule and retention. Disabling the policy stops future automatic backups but does not delete existing DB Service Backups.

### DB Service Restore

A non-destructive workflow that creates a new DB Service from a completed DB Service Backup. A DB Service Restore does not overwrite or roll back the source DB Service; the restored DB Service appears in the same Project and becomes the user's next Project Canvas focus.

### Logical Database

An engine-level database namespace exposed inside one DB Service, such as a PostgreSQL database, MySQL database, MongoDB database, or Redis database index. A Logical Database is an object browsed inside DB Access, not a Project Canvas DB resource.

### DB Deployment Settings

The creation-time choices for a new DB before the DB exists, including database engine, instance preset, and replica count. DB Deployment Settings are independent of entry path: they may create a DB together with a new Project or add a DB to an existing Project.

### DB Instance Preset

A user-facing resource-size choice for DB Deployment Settings. Each DB Instance Preset maps to one DB quota value; avoid exposing internal SKU-like labels such as `db.mysql.small` as the primary UI language.

### DB Settings

The primary UI surface for viewing and editing an existing DB's desired configuration after it has been created.

### Settings Draft

A local set of pending AP or DB settings changes that is submitted only when the user confirms a settings update. Discarding a Settings Draft abandons the pending changes and keeps the settings surface open.

_Avoid_: Cancellation, Cancel settings changes, Save settings changes.

### Database Binding

A runtime dependency where an AP is configured to consume one DB's connection credentials.

### Pending Database Binding Intent

An unsaved AP Environment draft intent to create or update a Database Binding by adding one or more AP Environment References to a DB Service. A Pending Database Binding Intent may be visualized on the Project Canvas as a pending AP-to-DB edge, but it is not a Canvas Connection until saved AP and DB resource state contains binding evidence.

A Pending Database Binding Intent is derived from explicit AP Environment References, not from ordinary user-authored DSN strings. Multiple AP Environment References from one AP Environment draft to the same DB Service collapse into one Pending Database Binding Intent, and an AP-to-DB Connecting Edge is only a shortcut for creating the same intent in AP Environment Settings.

_Avoid_: Pending edge, hidden binding record, inferred string binding.

### AP Environment Raw Source

The canonical AP environment editing model: the complete set of AP environment entries as the user can author them in `.env` form, including direct values, AP Environment References, and runtime environment expansions. Structured AP Environment controls are views or insertion aids over the AP Environment Raw Source, not separate saved state.

_Avoid_: Hidden binding metadata, editor-only environment language.

### AP Environment Reference

A product-level expression in the AP Environment Raw Source that points at a DB Service-provided environment value. An AP Environment Reference is resolved before runtime into ordinary AP environment entries, while the user-facing raw source may retain the reference expression.

_Avoid_: UI-only token, hidden binding metadata.

### DB Connection DSN

A complete connection string for one DB Service, including the credentials needed by an application to connect when the DB engine requires credentials.

_Avoid_: Address-only DSN, credential-free DATABASE_URL.

### DB Access

A resource workflow for inspecting, and when the product enables it editing, one DB Service's objects and data without exposing its connection credentials. DB Access is distinct from DB Settings: DB Settings changes a DB's desired configuration, while DB Access works with the Logical Databases and objects exposed by that DB Service.

_Avoid_: Data Browser, database browser.

### DB Terminal

An interactive terminal session that runs a DB Service's native engine client — such as `psql`, `mysql`, `mongosh`, or `redis-cli` — for ad-hoc, read-write commands against that DB Service. A DB Terminal is distinct from DB Access: DB Access is a structured object and data workflow, while a DB Terminal is a full interactive engine-client session. It is offered only for engines that ship a supported client and only while the DB Service is running.

_Avoid_: DB Console, console.

### AP Terminal

An interactive terminal session that opens a generic pod shell on an AP workload. An AP Terminal is distinct from a DB Terminal: both are terminals in the UI, but an AP Terminal is a workload shell while a DB Terminal is a database engine-client session.

_Avoid_: AP Console, console.

### Session Drawer

A bottom temporary project surface for one interactive resource session, such as an AP Terminal or DB Terminal. A Session Drawer is distinct from a Side Pane and may remain open while the user inspects resource details in a Side Pane.

### Container Node

A canvas node that represents an AP workload. The name is retained as a product/UI term, but it does not mean an individual Kubernetes container.

### Canvas Layout

A Project-scoped visual arrangement of the canvas, shared by everyone who opens that Project. Canvas Layout is the authoritative Canvas Placement Store: it is made of placements keyed by Canvas Placement Owners rather than by rendered node instances.

### Canvas Placement Owner

The stable Project Canvas identity that owns one visual placement. A Canvas Placement Owner may be a real resource or a Deployment Task projection, but a deployment-owned placement does not make the projection a resource.

A Project has one authoritative Canvas Placement Store, so resource placements and Deployment Projection Placements belong to the same Canvas Layout rather than separate stores.

### Generated Canvas Position

A deterministic placement proposed for a canvas item whose Canvas Placement Owner does not yet have a Canvas Layout position. Once accepted by Incremental Canvas Placement, it becomes part of Canvas Layout for that owner.

_Avoid_: recalculating a Generated Canvas Position for a node that already has a Canvas Layout position.

### First Canvas Placement

The first persisted Canvas Layout position for a Canvas Placement Owner. First Canvas Placement is used only when neither a resource-owned placement nor an inheritable deployment-owned placement already exists.

### User Canvas Placement

A Canvas Layout position created or changed by a user moving a canvas item. User Canvas Placement is authoritative over generated placement, Deployment Handoff, and Incremental Canvas Placement.

### Incremental Canvas Placement

A canvas placement rule that assigns positions only to Canvas Placement Owners without a Canvas Layout position. It preserves existing Canvas Layout positions and does not reinterpret user-arranged canvas structure when resources appear, disappear, or reconcile.

When Incremental Canvas Placement accepts a Generated Canvas Position, the placement save is scoped to the newly placed node or Canvas Placement Group rather than rewriting unrelated Canvas Layout nodes.

_Avoid_: using Incremental Canvas Placement to describe whole-canvas auto-layout.

### Canvas Placement Anchor

An existing canvas node or relationship fact used as the local reference for placing a canvas node that does not yet have a Canvas Layout position.

Incremental Canvas Placement prefers Canvas Placement Anchors that reflect resource relationships before using global open canvas space.

### Canvas Placement Group

A set of new canvas nodes that Incremental Canvas Placement positions together because they come from one user workflow or have direct resource relationship evidence. A Canvas Placement Group is not defined merely by appearing in the same resource refresh.

Canvas Placement Groups are evaluated together so related new nodes remain near one another when they first appear.

An AP with desired Public Address intent and its AP Public Access Node form a Canvas Placement Group while neither node has a Canvas Layout position. The AP is the group's primary resource node, and the AP Public Access Node is a presentation node for AP-owned public access rather than an independent resource.

After first placement, Canvas Placement Group membership does not imply that later user movement of one node moves the other nodes. During Deployment Handoff, Canvas Placement Group membership does not override existing per-slot Deployment Projection Placements.

### Canvas Viewport Focus

A temporary, per-view adjustment of the Project Canvas viewport that keeps a target canvas node visible within the currently available canvas area without changing Canvas Layout.

_Avoid_: using Canvas Layout to describe temporary viewport movement.

### Canvas Pointer Mode

The Project Canvas interaction mode for selecting resources, opening resource-scoped surfaces, moving canvas nodes, and starting Connecting Edge gestures.

Canvas Pointer Mode may change Canvas Layout when a canvas node is moved, depending on the Project Canvas read/write state. It is distinct from Canvas Viewport movement, which changes only the user's current view. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas Hand Mode

The Project Canvas interaction mode for browsing the canvas by moving the viewport without selecting resources, using resource quick actions, opening resource-scoped surfaces, moving canvas nodes, or starting Connecting Edge gestures.

Canvas Hand Mode preserves the current canvas selection and active project surfaces, and does not change Canvas Layout. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas Resource Identity

The product identity of a canvas node's backing AP, DB, or AP Public Access Node surface. Canvas Resource Identity is keyed by `kind`, `namespace`, and `name`, which keeps Canvas Layout stable across short reconciliation gaps.

For AP and DB nodes, `name` is the product resource name and also the primary underlying workload or Cluster name used by the Brain renderer. For AP Public Access Nodes, `name` is the associated AP name: the node represents that AP's Public Addresses surface, including pending allocation state.

Underlying Kubernetes UID is retained separately as the last-seen entity identity where available so the UI can detect when a same-named AP workload or DB Cluster is meaningfully new. AP Public Access Nodes use AP-bound identity and observed public access facts rather than their own Kubernetes UID.

### Canvas Node Expansion State

The per-node expanded or collapsed presentation state of a canvas node card.

### Canvas Node Stack Order

The per-node visual layering order used when canvas node cards overlap.

### Canvas Connection

A canvas edge that represents an established runtime dependency between resources.

Canvas Connections are derived from saved resource state. Removing Database Binding evidence in an unsaved AP Environment draft does not remove or hide the established AP-to-DB Canvas Connection before the AP environment update succeeds.

### Resource Action

A user-triggered command that changes an existing AP or DB resource state, such as start, stop, restart, delete, or toggling DB public access. A Resource Action belongs to the target resource rather than to the Project Canvas, Side Pane, Main Action Surface, Project Assistant Pane, or other surface that launched it.

_Avoid_: Canvas Action, node action.

### Resource Surface Intent

A user-triggered intent to open a resource-focused project surface for an existing AP or DB resource, such as Resource Logs, AP Terminal, DB Terminal, DB Access, or a Settings View. A Resource Surface Intent belongs to project surface orchestration rather than to the resource lifecycle.

_Avoid_: Canvas Action, node action, Resource Action when no resource state changes.

### Main Action Surface

A temporary project surface opened for focused resource work, occupying the project main area rather than the Project Assistant Pane. A Main Action Surface is distinct from a Side Pane because it is not a right-side inspection surface and may host different action-specific experiences over time.

### Side Pane

A non-modal, temporary project surface used for focused project work such as resource inspection, settings, or deployment flows.

A Side Pane is distinct from the Project Assistant Pane: the Project Assistant Pane is a persistent layout region for chat, while a Side Pane is a temporary surface triggered by a user action or assistant action.

### Project Assistant Pane

The persistent right-side project layout region that hosts assistant chat and related chat controls. It can trigger Side Panes, but is not itself a Side Pane.

### Connecting Edge

A temporary canvas interaction created when a user drags a line between canvas nodes. A Connecting Edge may become a domain command only when its endpoints match a supported resource relationship, regardless of drag direction.

### Workload Telemetry Series

A normalized time-series representation of workload resource usage for AP and DB workloads. It is consumed by both compact canvas node summaries and detailed metrics panels.

### Resource Logs

A read-only Main Action Surface for inspecting timestamped runtime output emitted by one AP or DB Service. Resource Logs are for recent or historical observation, not for interactive commands like AP Terminal or DB Terminal.

### Project Aggregate Status

A derived health tone for one Project row in the project list, computed from the phases of the Project's APs and DBs. It is not a persisted field on the Project product record; it is computed from sibling workload lists. It expresses "are the workloads inside this project healthy", which is what users look at on the list, and is distinct from whether the Project record itself exists.

### Project Display Name

The human-facing Project name shown in navigation, project chrome, project creation forms, and human confirmation prompts. It is stored on the Brain Project product record and is unique within a namespace after trimming surrounding whitespace and comparing case-insensitively. Avoid using Project name as a selector; stable identity uses Project ID.

### Custom Domain Binding

The relationship that attaches a Custom Domain to an AP by promoting one Platform Address as the CNAME target. The AP owns the user's binding intent and public access health; the AP Public Access Node only presents that AP-owned public access state on the canvas.

A Custom Domain Binding targets the App Listening Port selected on the promoted Platform Address. Binding a Custom Domain may also retarget that promoted Platform Address to a different App Listening Port.

Unbinding a Custom Domain removes that relationship and returns the promoted Platform Address to ordinary display; it does not delete the Platform Address or close public access.

### CNAME Verification Evidence

The remembered fact that a Custom Domain pointed to the promoted Platform Address when the Custom Domain Binding was submitted. It belongs to the Custom Domain Binding intent lifecycle and is not ongoing DNS monitoring.
