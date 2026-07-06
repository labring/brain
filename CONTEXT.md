# Domain Context

The ubiquitous language for the Brain product domain, grouped by area.

## Project & Navigation

### Project Description

A user-maintained optional Project summary that explains the Project's purpose or context. A Project Description may be authored when the Project is created or maintained later; an empty Project Description means the user has not described the Project.

_Avoid_: Deployment description, source description, generated summary.

### Project Display Name

The human-facing Project name shown in navigation, project chrome, project creation forms, and human confirmation prompts. It is stored on the Brain Project product record and is unique within a namespace after trimming surrounding whitespace and comparing case-insensitively. Avoid using Project name as a selector; stable identity uses Project ID.

### Project Aggregate Status

A derived health tone for one Project row in the project list, computed from the phases of the Project's APs and DBs. It is not a persisted field on the Project product record; it is computed from sibling workload lists. It expresses "are the workloads inside this project healthy", which is what users look at on the list, and is distinct from whether the Project record itself exists.

### Pinned Project

A current-user navigation preference that marks one Project for prominent access from product navigation. Pinned Projects are a small user-curated shortcut set, not a complete Project list; each entry points to Project ID and is not a shared Project property, Project Aggregate Status, recent Project, or workload lifecycle state.

_Avoid_: Favorite Project, starred Project, recent Project, sidebar Project.

### Last Viewed Unpinned Project Shortcut

A current-user navigation memory for the most recently opened unpinned Project in a namespace. It can remain visible while the user navigates to Pinned Projects or non-Project sidebar destinations, but it is not a Pinned Project, complete recent-project list, shared Project property, Project Aggregate Status, or workload lifecycle state.

When the Last Viewed Unpinned Project becomes a Pinned Project, it leaves this shortcut slot rather than falling back to an older Project.

_Avoid_: Current Project Shortcut, auto-pinned Project, recent Project, temporary Pinned Project, last viewed Pinned Project.

### Project Shortcut Icon

A presentation-only icon shown on a Project navigation shortcut. It may use a representative workload inside the Project as its visual source, but it is not Project identity, Project Aggregate Status, a persisted Project field, or a workload lifecycle state.

_Avoid_: Project identity icon, Project status icon, workload status icon.

## AP & Application Workloads

### AP (Application)

A Brain product resource that represents an application workload. AP owns the application's desired compute, environment, App Listening Ports, Private Addresses, and Platform Address allocation requests.

### AP Workload Readiness

The condition where an AP's application workload has enough running replicas to satisfy its AP Replica Strategy. AP Workload Readiness is distinct from AP Public Access Health; public routing may still be progressing after the workload is ready.

_Avoid_: AP Public Access Health, Public Address readiness, route readiness.

### AP Replica Strategy

The AP configuration choice for how many workload replicas should run: either a fixed user-selected count or Elastic Scaling within user-selected bounds.

### Fixed Replicas

An AP Replica Strategy where the user selects one desired replica count and the platform keeps the AP at that count.

### Elastic Scaling

An AP Replica Strategy where the platform automatically adjusts AP replicas between a user-selected minimum and maximum based on one selected resource utilization target.

### AP Configuration File

An AP-owned configuration file mounted into the application runtime through AP Settings. AP Configuration Files are user-authored file content and mount paths, not a standalone Settings Owner.

_Avoid_: ConfigMap, Config Files, configuration map.

### AP Storage Mount

A persistent volume an AP owns at one absolute container path, where the application's own data is kept across restarts and redeploys. An AP has zero or more AP Storage Mounts; each mount path is unique and fixed once created, and a mount's capacity can grow but never shrink. Distinct from an AP Configuration File, which mounts user-authored file content rather than application-written data.

_Avoid_: Volume, PVC, disk, persistent storage, storage size.

## AP Networking & Public Access

### App Listening Port

An AP container port where the application accepts traffic. Each AP has one or more App Listening Ports, identified by their unique port number within the AP. Each App Listening Port has one Private Address and may be targeted by zero or more Public Addresses. Creating a Public Address for a new target port initially adds an App Listening Port for that port, but the App Listening Port may later be removed without deleting the Public Address as long as at least one App Listening Port remains.

### Private Address

A cluster-internal URL for an AP, derived from one App Listening Port. An AP may have multiple Private Addresses when it exposes multiple App Listening Ports; once an App Listening Port exists, its Private Address is known and should not be modeled as pending.

### Public Address

An externally reachable URL/domain alias for an AP that declares a target port. It reaches the App Listening Port for that port when one exists, and editing that target port is Public Address editing rather than Custom Domain Binding.

### Platform Address

A system-assigned Public Address that the platform can create without user DNS or certificate setup. Users request one by choosing an App Listening Port rather than providing a host or URL; its host may be pending until the platform allocates it. A Platform Address may be promoted into the CNAME target for a Custom Domain Binding, after which its host remains the binding target rather than the primary displayed Public Address.

Platform Address health is based on whether the AP's platform routing support matches the AP's Public Address intent and target App Listening Port. It does not require a separately reported load balancer address before the Platform Address can be considered accessible.

### Custom Domain

A user-owned Public Address for an AP. A Custom Domain reaches an App Listening Port through a Custom Domain Binding.

Custom Domain health uses `verifying` while DNS ownership, certificate readiness, or routing readiness is still being established. It becomes `blocked` only when the binding is known not to be able to proceed without a changed user or platform action.

### Custom Domain Binding

The relationship that attaches a Custom Domain to an AP by promoting one Platform Address as the CNAME target. The AP owns the user's binding intent and public access health; the AP Public Access Node only presents that AP-owned public access state on the canvas.

A Custom Domain Binding targets the App Listening Port selected on the promoted Platform Address. Binding a Custom Domain may also retarget that promoted Platform Address to a different App Listening Port.

Unbinding a Custom Domain removes that relationship and returns the promoted Platform Address to ordinary display; it does not delete the Platform Address or close public access.

### CNAME Verification Evidence

The remembered fact that a Custom Domain pointed to the promoted Platform Address when the Custom Domain Binding was submitted. It belongs to the Custom Domain Binding intent lifecycle and is not ongoing DNS monitoring.

### Routing Scope

The public routing boundary within which one Custom Domain can belong to only one AP. In v1, the enforceable Routing Scope is the current Kubernetes namespace; broader cluster-wide uniqueness requires platform-level admission or indexing.

### AP Public Access Health

An AP-owned read-side assessment of each Public Address's public routing readiness and reachability, using routing states such as `progressing`, `verifying`, `accessible`, and `blocked`. It is routing health rather than application response monitoring: workload HTTP 404 or 500 responses do not make a Public Address unhealthy.

AP Settings and the AP Public Access Node may present AP Public Access Health, but it does not belong to a separate EntryPoint, AP Public Access Node, or independent public access resource.

An AP with no Public Address intent has no AP Public Access Health entries; this is absence of public access, not a blocked or unconfigured health state.

_Avoid_: EntryPoint health, AP Public Access Node health, standalone public access monitor.

### AP Public Access Node

An AP Public Access Node is a presentation-only Project Canvas node derived from an AP's Public Addresses. It is not a Brain product resource, backend API view, Kubernetes resource, or Settings Owner.

The node represents AP-owned public access, including pending Platform Addresses and Custom Domains; its user-visible label is Public access.

_Avoid_: EntryPoint, EntryPoint resource, EntryPoint API view, AP endpoints, Ingress.

### AP Network Settings

The AP-owned settings area for App Listening Ports, Private Addresses, Public Addresses, Platform Addresses, and Custom Domain Bindings. Private Addresses and Public Addresses are two views of the same AP Network Settings: Public Address changes may add App Listening Ports as part of the same Settings Draft.

AP Network Settings may appear inside the full AP Settings surface or a narrower Settings View, but they remain one AP Settings Draft domain rather than settings owned by an AP Public Access Node.

### Domain List

The AP Network Settings section that lists an AP's Public Addresses — Platform Addresses and Custom Domain Bindings — with their public routing state. Domain List is a public-routing view inside the AP settings surface: it may add App Listening Ports as part of Public Address edits, but it does not display Private Addresses and is not a standalone Settings Owner.

_Avoid_: EntryPoint list, Ingress list, domain manager.

## Database

### DB (Database)

A Brain product resource that represents a managed database workload available to APs in the same Project.

### DB Service

The user-facing database service represented by one DB resource and one database node on the Project Canvas. A DB Service may expose multiple engine-level Logical Databases through DB Access.

### Logical Database

An engine-level database namespace exposed inside one DB Service, such as a PostgreSQL database, MySQL database, MongoDB database, or Redis database index. A Logical Database is an object browsed inside DB Access, not a Project Canvas DB resource.

### DB Instance Preset

A user-facing resource-size choice for DB Deployment Settings. Each DB Instance Preset maps to one DB quota value; avoid exposing internal SKU-like labels such as `db.mysql.small` as the primary UI language.

### DB Service Backup

A named recovery point for an entire DB Service. A DB Service Backup may be manual or automatic, belongs to the DB Service rather than to one Logical Database or object inside it, and can be used for DB Service Restore after it completes. Deleting a DB Service Backup removes only that recovery point, not the source DB Service or any DB Service restored from it.

### DB Service Backup Policy

The automatic backup rule for one DB Service. A DB Service has at most one current DB Service Backup Policy; the policy is distinct from the DB Service Backups it creates and defines their schedule and retention. Disabling the policy stops future automatic backups but does not delete existing DB Service Backups.

### DB Service Restore

A non-destructive workflow that creates a new DB Service from a completed DB Service Backup. A DB Service Restore does not overwrite or roll back the source DB Service; the restored DB Service appears in the same Project, must have a DB Service name that is unique within that Project and namespace, and becomes the user's next Project Canvas focus.

### DB Access

A resource workflow for inspecting, and when the product enables it editing, one DB Service's objects and data without exposing its connection credentials. DB Access is distinct from DB Settings: DB Settings changes a DB's desired configuration, while DB Access works with the Logical Databases and objects exposed by that DB Service.

_Avoid_: Data Browser, database browser.

## Database Binding & AP Environment

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

## Settings

### Settings Owner

The resource whose desired configuration is edited by a settings surface. AP and DB resources can be Settings Owners; selecting an AP Public Access Node may open an AP-owned Settings View, but the AP Public Access Node is not the Settings Owner.

_Avoid_: EntryPoint Settings Owner, Public Access Node Settings Owner.

### Settings Domain

A Settings Owner configuration partition that can be independently checked for conflicts, submitted as a Pending Settings Update, reconciled against observed resource state, and cleared when applied. A Settings Domain is not a Settings Section, Settings View, or API field group.

_Avoid_: Settings Section, Settings View, form tab, API field group.

### Settings View

A settings entry point that presents one named subset of a resource's settings surface, containing one or more settings sections rather than necessarily showing the full settings surface. It remains part of that resource's settings surface and uses the same Settings Draft confirmation model as the full surface.

_Avoid_: Standalone Settings Section Pane, Section Pane, arbitrary section bundle.

### Settings Section

A coherent subset of a Settings Owner's configuration shown inside a Settings View. Settings Sections belong to their Settings Owner's settings surface and are not standalone panes, Component Registry items, or caller-selected arbitrary bundles.

_Avoid_: Registry Component, product workflow, standalone settings pane.

### AP Settings

The primary UI surface for viewing and editing AP desired configuration, including image, resource capacity, Replica Strategy, environment, and network settings.

### DB Settings

The primary UI surface for viewing and editing an existing DB's desired configuration after it has been created.

### Settings Draft

A local set of pending AP or DB settings changes that is submitted only when the user confirms a settings update. Discarding a Settings Draft abandons the pending changes and keeps the settings surface open.

_Avoid_: Cancellation, Cancel settings changes, Save settings changes.

### Settings Submission

An in-flight AP or DB settings write after the user confirms a settings update and before the product has accepted or rejected it. A Settings Submission is no longer an unsaved Settings Draft and may let the user leave the settings surface, but it is not a Pending Settings Update.

_Avoid_: Pending Settings Update, saved draft, optimistic resource truth.

### Pending Settings Update

A submitted AP or DB settings change that the product has accepted but the underlying resource has not yet fully reflected. A Pending Settings Update is no longer a Settings Draft: leaving the settings surface should not warn about unsaved changes, and reopening the Settings Owner should present the submitted target until the resource catches up or the user intentionally replaces it or chooses to use the latest observed configuration.

A Pending Settings Update belongs to a Settings Owner and one or more Settings Domains rather than to the Settings View that submitted it. A narrow Settings View and the full settings surface should therefore present the same submitted target for any domain they both include.

A Pending Settings Update may complete one Settings Domain at a time. When the observed resource catches up for one submitted domain, that domain's pending update is cleared without requiring unrelated submitted domains on the same Settings Owner to complete first.

_Avoid_: Submitted draft, saved draft, optimistic resource truth.

### Observed Settings Divergence

The condition where a Settings Owner's observed desired configuration for a Settings Domain changes to a value that is neither the Pending Settings Update's submitted target nor the observed desired configuration that target was submitted against. Observed Settings Divergence requires the user to choose whether to keep the submitted target or use the latest observed configuration.

_Avoid_: Pending failure, automatic overwrite, silent reload.

## Deployment

### Deployment Task

A deploy workflow work unit for creating or changing Project resources from a Deployment Source into a Deployment Target. A Deployment Task has one Deployment Runner and may produce Deployment Artifacts.

_Avoid_: GitHub task, deploy job, deployment request.

A Deployment Task is owned by the deployment domain, not by the Project Assistant Pane or any Chat thread. Chat may create, inspect, or explain a Deployment Task through tools, but the task's lifecycle, events, artifacts, and runner transcript remain deployment records.

### Deployment Source

The user-provided origin or intent for a Deployment Task, such as a GitHub repository, Docker image, database choice, application template, or natural-language deployment prompt. A Deployment Source describes what should be deployed, not where it should land.

_Avoid_: deploy input, entry path, creation method.

### Deployment Target

The Project relationship selected before a Deployment Task starts. A Deployment Target is either a new Project being created in the same flow or an existing Project that will receive the deployed resources.

_Avoid_: GitHub Deployment Target, Docker Deployment Target, project selector.

### Deployment Runner

The execution strategy for one Deployment Task. Direct and template runners use already-structured Deployment Sources, while an AI Runner interprets less-structured sources such as repositories or natural-language prompts.

_Avoid_: deterministic runner, task type, deploy engine.

### Deployment Artifact

A product resource description produced or selected by a Deployment Task for application into the Deployment Target. Deployment Artifacts are distinct from Deployment Source details and task progress messages.

_Avoid_: task output, generated file.

### GitHub Connection

A namespace-scoped authorization relationship that lets a workspace use a GitHub App installation to list and deploy repositories. A GitHub Connection belongs to the workspace namespace rather than one user's browser session or personal GitHub identity.

_Avoid_: personal GitHub token, user GitHub binding, browser GitHub connection.

### Docker Deployment Settings

The creation-time choices for a new AP before the AP exists, including Docker image, container launch command and arguments override, runtime environment variables, AP Configuration Files, AP Storage Mounts, App Listening Port, and whether to request a Platform Address. Docker Deployment Settings create an AP workload from an existing image, are independent of entry path, and should use Public Address or Network language rather than Ingress language in user-facing surfaces.

### DB Deployment Settings

The creation-time choices for a new DB before the DB exists, including database engine, instance preset, and replica count. DB Deployment Settings are independent of entry path: they may create a DB together with a new Project or add a DB to an existing Project.

### Deployment Task Projection

A Project-scoped read-side view of one Deployment Task containing only the facts needed by project surfaces to present deployment progress and resource handoff. It contains one or more Deployment Projection Slots and Deployment Preview Edges, but it does not own Canvas Layout positions.

Project Canvas consumes Deployment Task Projections rather than full Deployment Task records when rendering Deployment Placeholder Nodes and Deployment Handoff.

_Avoid_: task list row, canvas task, placeholder source data.

### Deployment Projection Slot

A task-local Project Canvas slot within one Deployment Task Projection. An unknown Deployment Projection Slot represents deployment progress before structured result evidence exists; a concrete slot may carry the anticipated result identity used for Deployment Handoff, but it is not a Canvas Resource Identity.

An unknown Deployment Projection Slot uses a stable unknown slot identity within its Deployment Task. A concrete Deployment Projection Slot uses an identity derived from its anticipated result reference, while the Canvas Placement Owner combines that slot identity with the Deployment Task identity.

Deployment Projection Slots are only for anticipated results that can become Project Canvas resource nodes. Template support objects may inform deployment progress, but they are not Deployment Projection Slots.

_Avoid_: generic placeholder identity, result-only slot, pending resource identity, fake Canvas Resource Identity, one slot per applied Kubernetes object.

### Deployment Projection Footprint

The visual group of currently visible Deployment Projection Slots for one Deployment Task Projection. A Deployment Projection Footprint may include AP, DB, AP Public Access Node, and template-visible workload slots from the same task; it is not limited to an AP-and-Public-access pair.

An unknown Deployment Projection Slot may represent the Deployment Projection Footprint's visual origin before concrete slots are known. When concrete Deployment Projection Slots become known, the unknown slot's placement is consumed into concrete slot placements rather than remaining as a separate placement.

Within a Deployment Projection Footprint, each AP Public Access Node slot remains visually paired with its owning AP slot; this pairing is independent of which slot anchors the whole footprint.

An AP Public Access Node Deployment Projection Slot has its own Deployment Projection Placement. When it has no placement yet, its initial generated placement may be derived from its owning AP's resource or projection placement.

AP-to-Public-access pairing guides generated placement; it does not override separately user-arranged placements.

_Avoid_: AP PublicAccess group, result pair, placeholder cluster.

### Deployment Projection Placement

The project-scoped temporary visual position owned by a Deployment Projection Slot before Deployment Handoff. Deployment Projection Placement is a Canvas Layout placement owned by the deployment projection, and it may be rekeyed to a resulting resource when handoff occurs.

A user-arranged Deployment Projection Placement represents the user's intended visual position for that Deployment Task Projection until Deployment Handoff; it should not be displaced by automatic footprint avoidance.

A generated Deployment Projection Placement is system-proposed and may be refined by later projection evidence until a user arranges it.

After concrete Deployment Projection Slots are known, arranging one concrete slot expresses intent for that slot only, not for the whole Deployment Projection Footprint.

_Avoid_: pending node layout, fake resource layout, viewport placement.

### Deployment Placeholder Node

A temporary Project Canvas skeleton node rendered for a Deployment Projection Slot that does not have a live resource node. It is a task projection, not an AP, DB, AP Public Access Node, template workload, Settings Owner, resource action target, or Canvas Connection endpoint.

_Avoid_: ghost node, pending node, pending AP, pending DB, fake resource node.

### Deployment Preview Edge

A temporary visual relationship between Deployment Projection Slots in one Deployment Task Projection. It is not a Canvas Connection and does not represent an established runtime dependency.

Deployment Preview Edges require explicit preview facts, such as generated AP-to-DB reference intent, template-declared dependency, or AP-to-Public-Access presentation relationship. Sharing one Deployment Task is not enough to create a Deployment Preview Edge.

_Avoid_: pending connection, fake edge, draft Canvas Connection.

### Deployment Handoff

The transition where a concrete Deployment Projection Slot stops being represented by a Deployment Placeholder Node and its matching result appears as a normal Project Canvas resource node. Deployment Handoff may rekey the slot's Deployment Projection Placement to the resulting resource when that resource has no existing Canvas Layout position.

Deployment Handoff may complete per slot while unresolved slots remain visible as Deployment Placeholder Nodes.

After Deployment Handoff, the resulting resource's placement is no longer arranged by the remaining Deployment Projection Footprint.

When a user-arranged Deployment Projection Placement is handed off, the resulting resource inherits that user placement intent.

_Avoid_: completed placeholder, ghost replacement, result takeover.

### Deployment Result Resource

A user-visible Project result that a Deployment Task creates or changes, such as an AP, DB, AP-owned Public Address, or template-visible workload. Support objects may explain a Deployment Result Resource's progress, but they are not Deployment Result Resources.

_Avoid_: applied object, Kubernetes object, support resource, raw manifest resource.

### Deployment Result Readiness

The condition where the user-visible result resources of a Deployment Task have become healthy enough for the task to be considered complete. Deployment Result Readiness is distinct from applying Deployment Artifacts; support objects may explain progress, but they do not by themselves define task completion.

_Avoid_: apply complete, resource created, manifest applied.

### Deployment Timeline Step

A runner-defined user-facing step in a Deployment Task Timeline. A Deployment Timeline Step may summarize multiple runner or backend execution phases; it does not need to match Deployment Task phase one-to-one.

A Deployment Runner should keep Deployment Timeline Step identity stable during a task run, even when the step status, events, or result details change.

_Avoid_: backend phase, runner phase, task status, fixed global timeline phase.

### Deployment Task Timeline

The user-facing progress view for one Deployment Task. A Deployment Task Timeline is made of runner-defined Deployment Timeline Steps and may include Deployment Result Resource Cards once the task has known result resources.

A Deployment Task Timeline belongs to the Deployment Task rather than to a browser session or Assistant Chat transcript.

_Avoid_: assistant chat transcript, backend event log, fixed deploy progress bar.

### Deployment Result Resource Card

A Deployment Task Timeline section for one Deployment Result Resource, presenting that resource's status and events within the task's progress. It is not a separate Deployment Task or a card for every applied Kubernetes object.

A Deployment Result Resource Card is based on known Deployment Result Resource evidence, not on speculative canvas projection alone.

Deployment Result Resource Cards use a shared task-facing status vocabulary, while their events may retain resource-specific detail.

On a Deployment Result Resource Card, blocked means the task can still proceed after an external action or changed condition; failed means the current task run has ended for that resource.

Deployment Result Resource Card events are grouped by the resource they explain, not primarily by the system that observed or emitted them.

Required Deployment Result Resource Cards determine whether Deployment Result Readiness has been reached; optional cards may continue to show progress or warnings without blocking task completion.

A Deployment Result Resource Card is not a Project Canvas node, Deployment Projection Slot, or Deployment Placeholder Node.

_Avoid_: Kubernetes object card, manifest card, task row, deployment placeholder card, canvas node.

### Deployment Task Display Summary

A compact user-facing description of a Deployment Task used on project surfaces where full task detail would be too heavy. It summarizes the Deployment Source and known or anticipated result resources; it is not the full source record, the Deployment Task Timeline, or the Deployment Task identity.

_Avoid_: task id label, source blob, timeline summary, generated title.

### Deployment Task Dock

A Project Canvas affordance that presents the current Project's visible Deployment Task Projections so users can notice active or attention-needed deployment work and re-enter each task's Deployment Task Timeline. It is not deployment history, a task list row, a Project Canvas node, or an Assistant Chat transcript.

A failed Deployment Task may remain attention-needed after its run ends until its current dock reminder is dismissed.

A successfully completed Deployment Task is not attention-needed merely because its projection remains available for Project Canvas handoff.

A successfully completed Deployment Task may briefly remain in the Deployment Task Dock as a current-session completion notice when the user observes it finish. This completion notice is not restored from Project bootstrap and is not deployment history.

_Avoid_: canvas task list, deployment history list, task center, chat task status.

### Deployment Task Dock Dismissal

A personal user acknowledgement of one Deployment Task Projection version in the Deployment Task Dock. It suppresses that task's dock reminder for that user until the projection changes; it is not shared Project state, task cancellation, task completion, task deletion, deployment history archival, or timeline deletion.

_Avoid_: close task, archive deployment, delete task, mark complete.

## Project Runtime & Read Model

### Project Runtime

The Project-scoped read-side boundary that Project surfaces use to interpret current resource presentation facts and session-local launch context. Project Runtime is not the Project Canvas, a Settings Owner, or the source of editable AP or DB desired configuration.

### Project Resource Read Model

The app-owned Project Runtime view of current AP, DB, and AP Public Access Node presentation facts. The Project Resource Read Model is read-side presentation knowledge, not raw resource truth, Canvas Layout, Settings Draft state, or a resource action command bus.

It may provide Settings display hints and relationship indexes, but those read-side hints do not identify the Settings Owner and are not editable Settings backing or Settings Launch Context.

### Settings Launch Context

Session-local Project Runtime memory that describes how one Project surface entry was opened. Settings Launch Context may carry launch source and transient bridge intent for the current browser session, but it is not route state, a Project surface entry, Canvas Layout, or editable Settings backing.

Settings Launch Context carries temporary intent, not caller-owned behavior. When the current browser session ends or the matching surface entry is no longer active, the launch context may disappear without changing the restored Settings Owner or Settings View.

A Settings Launch Context belongs to one active Project surface slot and one full settings entry identity, including the Settings View when a view is selected.

Route restoration may create a current-session launch source for the restored entry, but it does not restore transient bridge intent.

## Project Canvas

### Container Node

A canvas node that represents an AP workload. The name is retained as a product/UI term, but it does not mean an individual Kubernetes container.

### Canvas Resource Identity

The product identity of a canvas node's backing AP, DB, or AP Public Access Node surface. Canvas Resource Identity is keyed by `kind`, `namespace`, and `name`, which keeps Canvas Layout stable across short reconciliation gaps.

For AP and DB nodes, `name` is the product resource name and also the primary underlying workload or Cluster name used by the Brain renderer. For AP Public Access Nodes, `name` is the associated AP name: the node represents that AP's Public Addresses surface, including pending allocation state.

Underlying Kubernetes UID is retained separately as the last-seen entity identity where available so the UI can detect when a same-named AP workload or DB Cluster is meaningfully new. AP Public Access Nodes use AP-bound identity and observed public access facts rather than their own Kubernetes UID.

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

Deployment Projection Slots from one Deployment Task may be presented near one another while placement is generated, but that preview relationship is not a Canvas Placement Group; each slot owns its own Deployment Projection Placement.

After first placement, Canvas Placement Group membership does not imply that later user movement of one node moves the other nodes. During Deployment Handoff, Canvas Placement Group membership does not override existing per-slot Deployment Projection Placements.

### Canvas Viewport Focus

A temporary, per-view adjustment of the Project Canvas viewport that keeps a target canvas node visible within the currently available canvas area without changing Canvas Layout.

The currently available canvas area excludes temporary project surfaces that cover the canvas, such as a Side Pane or Session Drawer.

_Avoid_: using Canvas Layout to describe temporary viewport movement.

### Deployment Task Viewport Focus

A Canvas Viewport Focus for one Deployment Task that keeps the task's visible Deployment Placeholder Node or handed-off Deployment Result Resource nodes in the currently available canvas area. It is not Canvas Selection, Canvas Layout, Deployment Projection Placement, or a command to close project surfaces.

While a Deployment Placeholder Node remains visible for the Deployment Task, it is the task-facing focus target; after Deployment Handoff removes task placeholders, Deployment Result Resource nodes may stand in as the focus target.

When one Deployment Task has multiple visible focus targets, Deployment Task Viewport Focus keeps the target footprint visible rather than choosing only one node.

Deployment Task Viewport Focus is a one-shot focus caused by explicit task re-entry or by the first appearance of a focus target. Routine Deployment Task Timeline streaming updates should not repeatedly move the user's canvas viewport.

_Avoid_: deployment task selection, deployment task layout focus, close panels to focus task.

### Canvas Pointer Mode

The Project Canvas interaction mode for selecting resources, opening resource-scoped surfaces, moving canvas nodes, and starting Connecting Edge gestures.

Canvas Pointer Mode may change Canvas Layout when a canvas node is moved, depending on the Project Canvas read/write state. It is distinct from Canvas Viewport movement, which changes only the user's current view. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas Hand Mode

The Project Canvas interaction mode for browsing the canvas by moving the viewport without selecting resources, using resource quick actions, opening resource-scoped surfaces, moving canvas nodes, or starting Connecting Edge gestures.

Canvas Hand Mode preserves the current canvas selection and active project surfaces, and does not change Canvas Layout. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas Connection

A canvas edge that represents an established runtime dependency between resources.

Canvas Connections are derived from saved resource state. Removing Database Binding evidence in an unsaved AP Environment draft does not remove or hide the established AP-to-DB Canvas Connection before the AP environment update succeeds.

### Connecting Edge

A temporary canvas interaction created when a user drags a line between canvas nodes. A Connecting Edge may become a domain command only when its endpoints match a supported resource relationship, regardless of drag direction.

### Canvas Node Expansion State

The per-node expanded or collapsed presentation state of a canvas node card.

### Canvas Node Footprint

The rectangle a canvas node occupies in placement decisions. Card heights are content-driven, so a footprint's size comes from the node's rendered card; conservative expansion-state estimates stand in only for cards that have not been rendered yet.

### Canvas Node Stack Order

The per-node visual layering order used when canvas node cards overlap.

## Resource Actions & Affordances

### Resource Action

A user-triggered command that changes an existing AP or DB resource state, such as start, stop, restart, delete, or toggling DB public access. A Resource Action belongs to the target resource rather than to the Project Canvas, Side Pane, Main Action Surface, Project Assistant Pane, or other surface that launched it.

_Avoid_: Canvas Action, node action.

### Resource Surface Intent

A user-triggered intent to open a resource-focused project surface for an existing AP or DB resource, such as Resource Logs, AP Terminal, DB Terminal, DB Access, or a Settings View. A Resource Surface Intent belongs to project surface orchestration rather than to the resource lifecycle.

_Avoid_: Canvas Action, node action, Resource Action when no resource state changes.

### Resource Affordance

A user-facing entry point for either a Resource Action or a Resource Surface Intent. A Resource Affordance belongs to the target resource rather than to the Project Canvas or the surface where the entry point is shown.

_Avoid_: Canvas Action, node action.

### Resource Affordance Family

The set of Resource Affordances users can reasonably expect for one target kind. A Resource Affordance Family stays stable within that target kind, but mutually exclusive lifecycle affordances may resolve to the state-appropriate entries for the current resource state; a target kind without an established family should not gain placeholder or empty affordances for menu parity.

_Avoid_: one global node menu, cross-resource menu parity, node action set.

### Unavailable Resource Affordance

A Resource Affordance that applies to the target resource conceptually but cannot be used in the current project, session, resource state, or platform capability. An Unavailable Resource Affordance remains part of the user's resource mental model and presents a user-facing reason at the point where the user discovers the affordance; it is not a placeholder for unshipped roadmap capability.

_Avoid_: hidden unsupported action, missing menu item, future feature placeholder, node action.

### Unavailable Resource Affordance Reason

The reason an Unavailable Resource Affordance cannot currently be used, expressed in product terms such as read-only access, unavailable authentication, missing resource target identity, a busy resource state, unsupported platform capability, missing configuration, or an unknown cause.

_Avoid_: generic unavailable state, silent disabled state.

## Project Surfaces

### Side Pane

A non-modal, temporary project surface used for focused project work such as resource inspection, settings, or deployment flows.

A Side Pane is distinct from the Project Assistant Pane: the Project Assistant Pane is a persistent layout region for chat, while a Side Pane is a temporary surface triggered by a user action or assistant action.

### Main Action Surface

A temporary project surface opened for focused resource work, occupying the project main area rather than the Project Assistant Pane. A Main Action Surface is distinct from a Side Pane because it is not a right-side inspection surface and may host different action-specific experiences over time.

### Session Drawer

A bottom temporary project surface for one interactive resource session, such as an AP Terminal or DB Terminal. A Session Drawer is distinct from a Side Pane and may remain open while the user inspects resource details in a Side Pane.

### Project Assistant Pane

The persistent right-side project layout region that hosts assistant chat and related chat controls. It can trigger Side Panes, but is not itself a Side Pane.

### Assistant Pane Width

A per-device personal presentation preference for how wide the docked Project Assistant Pane is. It is not Canvas Layout, shared Project state, or the pane's open/closed visibility. The remembered width preserves the user's intent; presentation clamps it to what the current workspace can afford, without rewriting the remembered value.

While the user is resizing the Project Assistant Pane, Canvas Viewport Focus keeps following its target within the shrinking or growing canvas area; resizing does not count as the user taking manual control of the viewport.

_Avoid_: chat pane size, pane layout, shared pane width, Canvas Layout width.

## Sessions & Observability

### AP Terminal

An interactive terminal session that opens a generic pod shell on an AP workload. An AP Terminal is distinct from a DB Terminal: both are terminals in the UI, but an AP Terminal is a workload shell while a DB Terminal is a database engine-client session.

_Avoid_: AP Console, console.

### DB Terminal

An interactive terminal session that runs a DB Service's native engine client — such as `psql`, `mysql`, `mongosh`, or `redis-cli` — for ad-hoc, read-write commands against that DB Service. A DB Terminal is distinct from DB Access: DB Access is a structured object and data workflow, while a DB Terminal is a full interactive engine-client session. It is usable only for engines that ship a supported client and only while the DB Service is running; on engines without a supported client it is presented as an Unavailable Resource Affordance rather than omitted.

_Avoid_: DB Console, console.

### Resource Logs

A read-only Main Action Surface for inspecting timestamped runtime output emitted by one AP or DB Service. Resource Logs are for recent or historical observation, not for interactive commands like AP Terminal or DB Terminal.

### Live Log Window

The Resource Logs viewing state whose window is anchored to the present: it always covers the trailing relative span and keeps following newly emitted output. Choosing a relative span means entering or staying in this state; Resource Logs are always in exactly one of Live Log Window or Frozen Log Window.

_Avoid_: realtime toggle, auto-refresh interval, live mode flag, refresh switch.

### Frozen Log Window

The Resource Logs viewing state whose window is anchored to fixed wall-clock bounds and never moves on its own. Pausing a Live Log Window enters it by materializing the window bounds at that instant; applying an absolute range enters it directly. A Frozen Log Window is always described by its actual start and end, never as a relative span.

_Avoid_: custom range, paused relative range, snapshot mode, static last-hour view.

### Workload Telemetry Series

A normalized time-series representation of workload resource usage for AP and DB workloads. It is consumed by both compact canvas node summaries and detailed metrics panels.

### Workload Telemetry Snapshot

A latest-point summary of workload resource usage for one AP or DB workload. It is observational read-side data for compact resource presentation, not Canvas topology, Canvas Layout, Canvas Resource Identity, or resource lifecycle state.

_Avoid_: metric refresh, node state, resource status.

## Assistant & Billing

### Chat Billing Mode

Who pays for one assistant model call: `free` spends a Free Chat Turn funded by the platform, `user` bills the caller's AI Proxy. The mode is decided per turn — `free` while Free Chat Turns remain and a platform model is configured, otherwise `user` — and the handoff from `free` to `user` is automatic rather than a separate user action.

Chat Billing Mode, not the Free Chat Turns count, is the reliable signal for whether the caller is being charged. Because `free` also requires a configured platform model, a namespace with no platform model bills `user` from its first turn while its Free Chat Turns remain unspent; a `user` turn therefore does not imply Free Chat Turns are exhausted. Surfaces that present this state lead with Chat Billing Mode and only show the Free Chat Turns count while the mode is `free`.

_Avoid_: subscription tier, plan, quota mode.

### Free Chat Turns

A platform-funded allowance of assistant turns granted per namespace, consumed only after a turn completes successfully. Free Chat Turns are an entitlement counter, not a rate limit or a cap on AI Proxy usage.

_Avoid_: free tier, trial credits, message quota.

### AI Proxy

The per-cluster, OpenAI-compatible gateway (Sealos `aiproxy`) that serves user-billed assistant turns and charges the user's own cluster account. It is reached at the cluster's `aiproxy` host and is distinct from its `aiproxy-web` token-management sibling.

_Avoid_: model provider, LLM backend, OpenAI.

### AI Proxy Token

A user-scoped API key minted from the caller's kubeconfig through the `aiproxy-web` token endpoint so a `user`-billed turn can call the AI Proxy. An AI Proxy Token authorizes and bills one user; it is neither a platform credential nor the kubeconfig itself.

_Avoid_: system token, platform key, service account token.

## Design System

### Component Registry

An internal catalog for reusable UI components in the product design system. It is not a catalog for complete product surfaces, panes, or workflows.

### Registry Component

A reusable UI component eligible for the Component Registry. A Registry Component may carry product vocabulary, but it must be driven by a host surface and must not own a complete product workflow or settings lifecycle.

_Avoid_: Product Surface Registry, Pane Registry, Flow Registry.
