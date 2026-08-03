# Domain Context

The ubiquitous language for the Brain product domain, grouped by area.

## Project & Navigation

### Project Display Name

The human-facing Project name shown in navigation, project chrome, and human confirmation prompts. It is stored on the Brain Project product record and is unique within a namespace after trimming surrounding whitespace and comparing case-insensitively. It is not chosen during Project creation: the platform assigns a Derived Project Display Name, and users rename the Project afterwards. Avoid using Project name as a selector; stable identity uses Project ID.

### Derived Project Display Name

The default Project Display Name the platform assigns when a Project is created without an explicitly specified name, derived from the Deployment Task's Deployment Source; when the source yields no usable name, a readable random name is used instead. The platform resolves name collisions for derived names itself; an explicitly specified name is never silently altered — a collision is an error instead.

_Avoid_: random project name, auto name, generated title.

### Project Aggregate Status

A derived health tone for one Project row in the project list, computed from the phases of the Project's APs and DBs. It is not a persisted field on the Project product record; it is computed from sibling workload lists. It expresses "are the workloads inside this project healthy", which is what users look at on the list, and is distinct from whether the Project record itself exists.

### Pinned Project

A current-user navigation preference that marks one Project for prominent access from product navigation. Pinned Projects are a small user-curated shortcut set, not a complete Project list; each entry points to Project ID and is not a shared Project property, Project Aggregate Status, recent Project, or workload lifecycle state.

_Avoid_: Favorite Project, starred Project, recent Project, sidebar Project.

### App Sidebar

The persistent left-edge product navigation surface containing product-level navigation, Project Shortcuts, and app-level actions. It is outside the Project Canvas and is not a Project List, Side Pane, or Project Assistant Pane.

_Avoid_: Project list, left Side Pane, sidebar Project.

### Project Shortcut

A Project navigation entry in the App Sidebar. Project Shortcuts comprise the current user's Pinned Projects and at most one last-viewed unpinned Project; they are not the complete Project List or Project List rows.

_Avoid_: Sidebar Project, Project List row.

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

### AP Storage Mount

A persistent volume an AP owns at one absolute container path, where the application's own data is kept across restarts and redeploys. An AP has zero or more AP Storage Mounts; each mount path is unique and fixed once created, and a mount's capacity can grow but never shrink. Distinct from an AP Configuration File, which mounts user-authored file content rather than application-written data.

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

_Avoid_: AP Public Access Node health, standalone public access monitor.

### AP Public Access Node

An AP Public Access Node is a presentation-only Project Canvas node derived from an AP's Public Addresses. It is not a Brain product resource, backend API view, Kubernetes resource, or Settings Owner.

The node represents AP-owned public access, including pending Platform Addresses and Custom Domains; its user-visible label is Public access.

### AP Network Settings

The AP-owned settings area for App Listening Ports, Private Addresses, Public Addresses, Platform Addresses, and Custom Domain Bindings. Private Addresses and Public Addresses are two views of the same AP Network Settings: Public Address changes may add App Listening Ports as part of the same Settings Draft.

AP Network Settings may appear inside the full AP Settings surface or a narrower Settings View, but they remain one AP Settings Draft domain rather than settings owned by an AP Public Access Node.

### Domain List

The AP Network Settings section that lists an AP's Public Addresses — Platform Addresses and Custom Domain Bindings — with their public routing state. Domain List is a public-routing view inside the AP settings surface: it may add App Listening Ports as part of Public Address edits, but it does not display Private Addresses and is not a standalone Settings Owner.

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

### DB Access Session

A browser-local DB Access workspace for one DB Service, containing its open DB Access Object Views and their interaction state. Switching to a different DB Service ends the current DB Access Session; returning starts a new session with no retained tabs or view state.

_Avoid_: Database connection, DB Terminal session.

### DB Access Object View

An open-tab presentation of one Logical Database object within DB Access. Within one DB Service's DB Access surface, an object has at most one open DB Access Object View; opening it again activates the existing view rather than creating an independent view.

Its interaction state is retained while the tab remains open, including while another tab is active; closing the tab discards that state, so reopening the object starts from the default view state.

### System Object

A Logical Database object provisioned by the database engine, an installed extension, or platform operator tooling rather than authored by the user. System Objects are not part of the user's own data model: DB Access omits them from the default object list and shows them only on explicit request within a DB Access Session.

_Avoid_: operator object, Spilo object, internal table, system table.

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

A complete connection string for one DB Service, including the credentials needed by an application to connect when the DB engine requires credentials. A DB Connection DSN is produced only by an explicit reveal or copy action; default DB read surfaces carry a DB Connection Template instead.

_Avoid_: Address-only DSN, credential-free DATABASE_URL.

### DB Connection Template

A credential-free connection string for one DB Service whose username and password segments are literal placeholders and whose address and database name are real. The DB Connection Template identifies which DB Service a value points at without containing credentials, and is what DB read surfaces carry by default.

_Avoid_: Masked DSN, redacted connection string.

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

## Authorization & Identity

### Workspace Actor

The verified human identity acting within a workspace namespace, established
by two cross-checked credentials: the request kubeconfig's bearer token
authenticates live workspace access as the subject
`system:serviceaccount:user-system:<crName>`, and the desktop-minted app
token proves that crName's binding to the global `userUid`, which is the
actor's subject key for personal-resource ownership. Workspace Actor
verification and namespace authorization are separate checks: one establishes
who is acting, while the other establishes where that actor may act. A
Desktop session user id, an unverified app-token claim, and an arbitrary
namespace-authorized workload ServiceAccount are not Workspace Actors.

_Avoid_: Desktop user id, namespace member id, ServiceAccount UID, crName owner key, selected actor.

### Identity Fingerprint

The authorization layer's region-local record of the most recently observed
`crName → userUid` binding and that binding's minting time. A fingerprint is
an observation history, not an authoritative mapping — authority stays with
desktop's token minting. A newer-minted contradiction signals an account
merge and re-keys the swallowed uid's personal resources to the surviving
uid; an older-minted binding marks a superseded token, which is refused.

_Avoid_: uid mapping table, user directory, identity cache.

## Deployment

### Deployment Task

A deploy workflow work unit for creating or changing Project resources from a Deployment Source into a Deployment Target. A Deployment Task has one Deployment Runner and may produce Deployment Artifacts.

_Avoid_: GitHub task, deploy job, deployment request.

A Deployment Task is owned by the deployment domain, not by the Project Assistant Pane or any Chat thread. Chat may create, inspect, or explain a Deployment Task through tools, but the task's lifecycle, events, artifacts, and Deployment Task Timeline remain deployment records. Chat inspects task progress through fixed AI event messages and the task-owned safe Timeline; a runner transcript, provider error/status, Gateway locator, and Devbox locator are not public status or progress contracts and are not projected to Chat.

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

### Deployment Task Lease

The exclusive execution right for one Deployment Task, claimed inline by the credentialed request that launches the run (creation or Blocking Input submission) and renewed by that process for as long as the run is in flight; a task without a live lease is not executing, and an expired lease on an active task means the owning process died. The lease epoch fences state writes from superseded executions. A lease is engine state, not a UI concept.

_Avoid_: task lock, running flag, worker pin, heartbeat.

### Deployment Task Cancel Request

A recorded user intent to stop an active Deployment Task, acknowledged cooperatively by the runner at a checkpoint and resolved to `cancelled` by the engine when unacknowledged past its deadline. Cancelling stops the deploy workflow; it never deletes or reverts applied resources, and the task keeps itemized evidence of what was applied.

_Avoid_: force kill, rollback, undo deployment, cancelling status.

### Redeploy

Recovery for a failed or cancelled Deployment Task: a new Deployment Task cloned from the predecessor's Deployment Source and Deployment Target with recorded lineage, reusing result identities the predecessor already allocated. A Redeploy may carry edited source settings; there is no in-place retry of a terminal Deployment Task. Any namespace-authorized member may initiate it, but a GitHub Redeploy creates a new Deployment Credential Binding from the initiator's own active GitHub Connection; it never inherits the predecessor's creating actor, credential owner, or connection reference, and without the initiator's connection no new task is created.

_Avoid_: retry, re-run, attempt, task restart.

### Deployment Action Actor

The Workspace Actor who initiates a Deployment Task or performs a collaborative
Deployment Task action such as cancellation, Blocking Input submission, or
Redeploy. Deployment Task events record the action actor when one is available,
while namespace-authorized non-Workspace-Actor subjects may still perform the
namespace-shared actions that permit them. A Deployment Action Actor describes
who performed an action; it does not transfer or replace the task's Deployment
Credential Binding.

_Avoid_: credential owner, task owner, connection owner.

### Deployment Credential Binding

The immutable selection on a GitHub Deployment Task that identifies the
credential-owning Workspace Actor, that actor's GitHub Connection reference,
and the binding version chosen at task creation. Collaborative task actions do
not change the binding. Redeploy creates a new task and resolves a new binding
from its initiator rather than copying the predecessor's binding. The binding
records credential selection and ownership; it does not imply task-scoped
runtime credential issuance or isolation.

_Avoid_: Task Credential Grant, mutable task credential, action actor.

### Deployment Task Retention

The automatic cleanup boundary for Deployment Task records: terminal tasks, their events, runner transcripts, and per-task deploy runtimes are purged after a fixed window. Active and blocked tasks are never purged, and there is no user-facing task deletion.

_Avoid_: delete task, clear history, archive task.

### GitHub Connection

A personal OAuth authorization that lets one Workspace Actor list and deploy from their own GitHub repositories within a namespace. A GitHub Connection is keyed by namespace, verified Workspace Actor, and owner identity generation; no client-supplied Desktop user id or opaque connection id selects its owner. Each Workspace Actor authorizes GitHub separately, and one actor's connection is not a shared namespace credential that another actor may select for a new Deployment Task. Task creation records the resulting Deployment Credential Binding. Disconnecting forgets the connection locally; the GitHub-side authorization survives until revoked on GitHub, and choosing or switching GitHub accounts happens at connect time, never at disconnect (ADR-0057).

_Avoid_: shared namespace GitHub credential, GitHub App installation connection, browser-session GitHub connection, Desktop-user-owned connection.

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

Deployment Projection Slots are only for anticipated results that can become Project Canvas resource nodes. Template support objects may inform deployment progress, but they are not Deployment Projection Slots.

_Avoid_: generic placeholder identity, result-only slot, pending resource identity, fake Canvas Resource Identity, one slot per applied Kubernetes object.

### Deployment Projection Footprint

The visual group of currently visible Deployment Projection Slots for one Deployment Task Projection. A Deployment Projection Footprint may include AP, DB, AP Public Access Node, and template-visible workload slots from the same task; it is not limited to an AP-and-Public-access pair.

Within a Deployment Projection Footprint, each AP Public Access Node slot remains visually paired with its owning AP slot; the pairing guides generated placement and does not override separately user-arranged placements.

_Avoid_: AP PublicAccess group, result pair, placeholder cluster.

### Deployment Projection Placement

The project-scoped temporary visual position owned by a Deployment Projection Slot before Deployment Handoff. Deployment Projection Placement is a Canvas Layout placement owned by the deployment projection, and it may be rekeyed to a resulting resource when handoff occurs.

A user-arranged Deployment Projection Placement is authoritative and should not be displaced by automatic footprint avoidance; a generated placement is system-proposed and may be refined by later projection evidence until a user arranges it.

_Avoid_: pending node layout, fake resource layout, viewport placement.

### Deployment Placeholder Node

A temporary Project Canvas skeleton node rendered for a Deployment Projection Slot that does not have a live resource node. It is a task projection, not an AP, DB, AP Public Access Node, template workload, Settings Owner, resource action target, or Canvas Connection endpoint.

_Avoid_: ghost node, pending node, pending AP, pending DB, fake resource node.

### Deployment Preview Edge

A temporary visual relationship between Deployment Projection Slots in one Deployment Task Projection. It is not a Canvas Connection and does not represent an established runtime dependency.

Deployment Preview Edges require explicit preview facts, such as generated AP-to-DB reference intent, template-declared dependency, or AP-to-Public-Access presentation relationship. Sharing one Deployment Task is not enough to create a Deployment Preview Edge.

_Avoid_: pending connection, fake edge, draft Canvas Connection.

### Deployment Handoff

The transition where a concrete Deployment Projection Slot stops being represented by a Deployment Placeholder Node and its matching result appears as a normal Project Canvas resource node. Deployment Handoff may rekey the slot's Deployment Projection Placement to the resulting resource when that resource has no existing Canvas Layout position, and may complete per slot while unresolved slots remain visible as Deployment Placeholder Nodes.

_Avoid_: completed placeholder, ghost replacement, result takeover.

### Deployment Handoff Placement Conflict

The condition where multiple matching Deployment Projection Slots offer incompatible Deployment Projection Placements to the same unplaced Deployment Result Resource and no single user-arranged placement unambiguously outranks the others. Task ordering does not resolve the conflict; the resource receives First Canvas Placement and the conflicting projection placements are consumed.

_Avoid_: task-order winner, last projection wins, placement race.

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

A Deployment Task Timeline section for one Deployment Result Resource, presenting that resource's status and events within the task's progress. It is not a separate Deployment Task, a card for every applied Kubernetes object, or a Project Canvas node.

On a Deployment Result Resource Card, blocked means the task can still proceed after an external action or changed condition; failed means the current task run has ended for that resource.

Required Deployment Result Resource Cards determine whether Deployment Result Readiness has been reached; optional cards may continue to show progress or warnings without blocking task completion.

_Avoid_: Kubernetes object card, manifest card, task row, deployment placeholder card, canvas node.

### Deployment Failure Reason

The stable classification and corresponding user-facing action shown on a failed Deployment Timeline Step. Integration boundaries and the Deployment Task Engine record the narrowest reason they can prove; an unclassified failure uses `unknown` and includes the Task ID for support. A Deployment Failure Reason is safe to persist and aggregate, and is not a raw stack trace or provider response.

_Avoid_: generic failure message, raw stack trace, provider response, unstructured error bucket.

### Deployment Failure Detail

The expandable, copyable diagnostic context under a failed Deployment Timeline Step. Direct/template runners show their known-value-scrubbed provider or Kubernetes error. The AI runner never shows its raw Gateway or command error; it shows only allowlisted fields such as reason code, phase, validated HTTP status, and Task ID. It is not a browser-only value, an unredacted AI error, or a separate Deployment Task.

_Avoid_: raw AI error dump, unredacted error, secret-bearing provider response, server log line.

### Deployment Task Display Summary

A compact user-facing description of a Deployment Task used on project surfaces where full task detail would be too heavy. It summarizes the Deployment Source and known or anticipated result resources; it is not the full source record, the Deployment Task Timeline, or the Deployment Task identity.

_Avoid_: task id label, source blob, timeline summary, generated title.

### Deployment Task Dock

A Project Canvas affordance that presents the current Project's visible Deployment Task Projections so users can notice active or attention-needed deployment work and re-enter each task's Deployment Task Timeline. It is not deployment history, a task list row, a Project Canvas node, or an Assistant Chat transcript.

A dock chip carries no inline lifecycle actions: it shows a source summary and status, opens the Deployment Task Timeline pane on click, and — for terminal tasks only — offers a dismiss control. Cancel and Redeploy are performed in the Deployment Task Timeline pane the chip opens, not on the chip itself.

The dock shows as many of the highest-priority tasks as fit the space available to it — never a fixed count — and keeps the remainder reachable behind a single overflow control. Visible chips stay readable rather than shrinking without bound; a chip that cannot stay readable folds into the overflow, and on the narrowest surfaces the dock may degrade to the overflow control alone. The open pane's task gets no special claim on a visible chip.

_Avoid_: canvas task list, deployment history list, task center, chat task status.

### Deployment Task Dock Dismissal

A personal user acknowledgement of one Deployment Task Projection version in the Deployment Task Dock, available only for terminal tasks (failed, completed, or cancelled). It suppresses that task's dock reminder for that user until the projection changes; it is not shared Project state, task cancellation, task deletion, or deployment history archival.

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

### Project Canvas Workbench

The single module that orchestrates the Project Canvas page. It takes three identifiers (kubeconfig, namespace, project) and returns three semantic groups: actions, canvas, and surfaces. It privately instantiates Project Runtime observation and Canvas Layout persistence, and it coordinates Project Surfaces, canvas selection and route sync, Settings Launch Context, leave guards, the Deployment Task Dock and Timeline, Resource Actions, and viewport directives.

Its orchestration decisions are pure transitions in a plain TypeScript core; the React hook only reads facts, submits events, and executes the returned effect plans. The workbench interface is the test surface for all of the behavior above.

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

### Missing Resource Layout Grace

A reconciliation window during which a resource-owned Canvas Layout placement remains retained after the Project Resource Read Model stops reporting that resource. It protects shared placement from transient read-side absence; continuous absence beyond the window may remove the placement.

_Avoid_: resource deletion grace, Deployment Handoff grace, missing node grace.

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

A set of new canvas nodes that Incremental Canvas Placement positions together because they come from one user workflow or have direct resource relationship evidence — for example, an AP with desired Public Address intent and its AP Public Access Node while neither has a Canvas Layout position. A Canvas Placement Group is not defined merely by appearing in the same resource refresh, and membership does not imply that later user movement of one node moves the others.

Deployment Projection Slots presented near one another are not a Canvas Placement Group; each slot owns its own Deployment Projection Placement.

### Canvas Viewport Focus

A temporary, per-view adjustment of the Project Canvas viewport that keeps a target canvas node visible within the currently available canvas area without changing Canvas Layout.

The currently available canvas area excludes temporary project surfaces that cover the canvas, such as a Side Pane or Session Drawer.

_Avoid_: using Canvas Layout to describe temporary viewport movement.

### Deployment Task Viewport Focus

A Canvas Viewport Focus for one Deployment Task that keeps the task's visible Deployment Placeholder Node or handed-off Deployment Result Resource nodes in the currently available canvas area. It is not Canvas Selection, Canvas Layout, Deployment Projection Placement, or a command to close project surfaces.

It is a one-shot focus caused by explicit task re-entry or by the first appearance of a focus target; routine Deployment Task Timeline streaming updates should not repeatedly move the user's canvas viewport.

_Avoid_: deployment task selection, deployment task layout focus, close panels to focus task.

### Canvas Pointer Mode

The Project Canvas interaction mode for selecting resources, opening resource-scoped surfaces, moving canvas nodes, and starting Connecting Edge gestures. Canvas interaction mode is session-local and is not part of URL state or Canvas Layout.

### Canvas Hand Mode

The Project Canvas interaction mode for browsing the canvas by moving the viewport only. Canvas Hand Mode preserves the current canvas selection and active project surfaces, and does not change Canvas Layout.

### Canvas Connection

A canvas edge that represents an established runtime dependency between resources.

Canvas Connections are derived from saved resource state. Removing Database Binding evidence in an unsaved AP Environment draft does not remove or hide the established AP-to-DB Canvas Connection before the AP environment update succeeds.

### Connecting Edge

A temporary canvas interaction created when a user drags a line between canvas nodes. A Connecting Edge may become a domain command only when its endpoints match a supported resource relationship, regardless of drag direction.

### Canvas Node Footprint

The rectangle a canvas node occupies in placement decisions. Card heights are content-driven, so a footprint's size comes from the node's rendered card; conservative expansion-state estimates stand in only for cards that have not been rendered yet.

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

### Side Pane Footer

The pinned action region at the bottom of a Side Pane that stays visible while the pane's content scrolls. It presents the hosted surface's pane-level actions — a deploy form's submit, a Settings Draft's confirmation controls with their conflict and failure context, or a Deployment Task's lifecycle actions. Which actions it carries is decided by the surface hosted in the pane, not by the pane itself; a surface without pane-level actions has no Side Pane Footer, and an action that belongs to one content row or step stays in the content.

_Avoid_: scrolled bottom button, sticky form button, per-row action in footer.

### Main Action Surface

A temporary project surface opened for focused resource work, occupying the project main area rather than the Project Assistant Pane. A Main Action Surface is distinct from a Side Pane because it is not a right-side inspection surface and may host different action-specific experiences over time.

### Session Drawer

A bottom temporary project surface for one interactive resource session, such as an AP Terminal or DB Terminal. A Session Drawer is distinct from a Side Pane and may remain open while the user inspects resource details in a Side Pane.

### Project Assistant Pane

The persistent right-side project layout region that hosts assistant chat and related chat controls. It can trigger Side Panes, but is not itself a Side Pane.

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

A normalized time-series representation of workload resource usage for AP and DB workloads. It is consumed by both compact canvas node summaries and detailed metrics panels. Metrics panels always present it as a live trailing window whose leading edge is the present ("Now"); unlike Resource Logs there is no frozen counterpart. Absolute clock times appear only as interior reference points, never as window bounds.

_Avoid_: frozen metrics window, custom metrics range.

### Workload Telemetry Snapshot

A latest-point summary of workload resource usage for one AP or DB workload. It is observational read-side data for compact resource presentation, not Canvas topology, Canvas Layout, Canvas Resource Identity, or resource lifecycle state.

_Avoid_: metric refresh, node state, resource status.

### Workload Telemetry Authorization

The access decision for a Workload Telemetry Series or Snapshot: a caller may read a workload's telemetry only if it can read that workload itself under its own credentials. Authorization is per workload (namespace + name), not per namespace, and is a Kubernetes RBAC read of the workload's backing object — the AP's Deployment or StatefulSet, the DB's Cluster — so holding a parseable kubeconfig is never sufficient. A denial is indistinguishable from an absent workload, so it never reveals whether another tenant's workload exists.

_Avoid_: namespace access check, kubeconfig validation, metrics permission.

## Assistant & Billing

### Assistant Conversation

A private assistant chat thread and its messages, scoped to a namespace and owned by the Workspace Actor who started it. Assistant Conversation ownership is an enforced authorization boundary in addition to namespace authorization: list, bootstrap, read, append, continue, and title operations are owner-scoped, and a foreign conversation is indistinguishable from a missing one. Ownership is fixed at creation and does not transfer when the conversation is continued. Assistant Conversations are personal artifacts, unlike namespace-shared Canvas Layouts and Deployment Tasks; Free Chat Turns remain a namespace-shared allowance.

_Avoid_: shared namespace chat, tenant chat, client-selected owner, chatId capability, per-namespace chat history.

### Chat Billing Mode

Who pays for one assistant model call: `free` spends a Free Chat Turn funded by the platform, `user` bills the caller's AI Proxy. The mode is decided per turn — `free` while Free Chat Turns remain and a platform model is configured, otherwise `user` — and the handoff from `free` to `user` is automatic rather than a separate user action.

Chat Billing Mode, not the Free Chat Turns count, is the reliable signal for whether the caller is being charged. Because `free` also requires a configured platform model, a namespace with no platform model bills `user` from its first turn while its Free Chat Turns remain unspent; a `user` turn therefore does not imply Free Chat Turns are exhausted. Surfaces that present this state lead with Chat Billing Mode and only show the Free Chat Turns count while the mode is `free`.

_Avoid_: subscription tier, plan, quota mode.

### Free Chat Turns

A platform-funded allowance of assistant turns granted per namespace, consumed only after a turn completes successfully. Free Chat Turns are an entitlement counter, not a rate limit or a cap on AI Proxy usage. Free Chat Turns remain per-namespace even though an Assistant Conversation is per-user: the allowance is a shared workspace grant, not a per-user entitlement.

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
