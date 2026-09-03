# Domain Context

The ubiquitous language for the Brain product domain, grouped by area.

## Project & Navigation

### Project Display Name

The human-facing Project name shown in navigation and confirmation prompts, stored on the Brain Project record and unique within a namespace (trimmed, case-insensitive). It is not chosen at creation: the platform derives a default from the Deployment Task's Deployment Source (falling back to a readable random name) and resolves collisions for derived names itself, while an explicitly specified name is never silently altered — a collision is an error. Never a selector; stable identity uses Project ID.

_Avoid_: auto name, generated title.

### Project Aggregate Status

A derived health tone for one Project row in the project list, computed from the phases of the Project's APs and DBs — not a persisted field on the Project record. It expresses whether the workloads inside the project are healthy, which is distinct from whether the Project record itself exists.

### Pinned Project

A current-user navigation preference that marks one Project for prominent access in product navigation. A small user-curated shortcut set, not a shared Project property or a recent-projects list.

_Avoid_: Favorite Project, starred Project, recent Project.

### App Sidebar

The persistent left-edge product navigation surface containing product-level navigation, Project navigation (Pinned Projects and all other Projects), and app-level actions. It is outside the Project Canvas and is not a Side Pane or a Project list. It has exactly two user-controlled states, and these are their canonical names: **Expanded** (icons with text labels) and **Collapsed** (an icon rail with tooltips). Before the user has ever changed it, the App Sidebar is Collapsed; thereafter the user's last chosen state is remembered per browser. State changes only by explicit user action and is independent of viewport width.

_Avoid_: Project list, left Side Pane, Project Shortcut (retired term), open/closed sidebar, full/mini sidebar, rail mode.

### Sealos Desktop Entry

The app-level link out to the platform's Sealos Desktop (user-visible label: Sealos Desktop), a menu row inside the App Sidebar's account popover. It opens the Desktop alongside Brain rather than replacing it — an exit to the platform layer, not in-app navigation, which is why the label names the destination instead of claiming a return.

_Avoid_: Back to Desktop (retired label), desktop return, home.

### Project Icon

The small glyph identifying a Project in navigation surfaces such as the App Sidebar's Project rows. Presentation-only and derived from the Project's workloads — the brand of a recognized AP container image, or the DB engine when the Project has no AP — falling back to a generic container mark when nothing is recognized. Not a persisted Project property and not user-chosen.

_Avoid_: Project Shortcut Icon (retired term), project logo, project avatar.

## AP & Application Workloads

### AP (Application)

A Brain product resource that represents an application workload. AP owns the application's desired compute, environment, App Listening Ports, Private Addresses, and Platform Address allocation requests.

### AP Workload Readiness

The condition where an AP's workload has enough running replicas to satisfy its AP Replica Strategy. Distinct from AP Public Access Health: public routing may still be progressing after the workload is ready.

### AP Replica Strategy

The AP configuration choice for how many workload replicas should run: either **Fixed Replicas** (one user-selected count the platform maintains) or **Elastic Scaling** (the platform adjusts replicas between user-selected bounds based on one resource utilization target).

### AP Configuration File

An AP-owned configuration file mounted into the application runtime through AP Settings: user-authored file content plus a mount path, not application-written data and not a standalone Settings Owner.

### AP Storage Mount

A persistent volume an AP owns at one absolute container path, keeping application-written data across restarts and redeploys. Mount paths are unique and fixed once created; capacity can grow but never shrink. Distinct from an AP Configuration File, which mounts user-authored content.

### AP Image Version

A retained record of one AP's previously applied image configuration — the image reference together with the desired-configuration snapshot it shipped with — kept per AP as a bounded set of recent versions for review and rollback. Rollback is a Resource Action restoring the AP's desired configuration from a selected version; it is not a Deployment Task, a Redeploy, or a Settings edit. Changing the image itself is AP Settings work, and an image update produces a new version rather than modifying an existing one. The versions surface may host an entry point for such an update, but the update remains AP Settings work with the same pending and divergence lifecycle as any settings edit — the surface itself stays a Resource Surface, not a Settings View, and Rollback stays a Resource Action.

_Avoid_: deployment (for an image revision), AP Deployments Pane.

## AP Networking & Public Access

### App Listening Port

An AP container port where the application accepts traffic, identified by its unique port number within the AP. Each App Listening Port has one Private Address and may be targeted by zero or more Public Addresses.

### Private Address

A cluster-internal URL for an AP, derived from one App Listening Port. Once the port exists its Private Address is known — never model it as pending.

### Public Address

An externally reachable URL/domain alias for an AP that declares a target port and reaches the App Listening Port for that port. Its two kinds are Platform Address and Custom Domain; editing the target port is Public Address editing, not Custom Domain Binding.

### Platform Address

A system-assigned Public Address the platform creates without user DNS or certificate setup; users request one by choosing an App Listening Port, and its host may be pending until allocated. A Platform Address may be promoted into the CNAME target for a Custom Domain Binding. Its health reflects whether platform routing support matches the AP's public access intent — it does not wait on a separately reported load balancer address.

### Custom Domain

A user-owned Public Address that reaches an App Listening Port through a Custom Domain Binding; within one routing scope (v1: the Kubernetes namespace) a Custom Domain can belong to only one AP. Health is `verifying` while DNS ownership, certificates, or routing are still being established, and `blocked` only when the binding cannot proceed without a changed user or platform action.

### Custom Domain Binding

The relationship that attaches a Custom Domain to an AP by promoting one Platform Address as the CNAME target; the AP owns the binding intent and its public access health. The remembered fact that the domain pointed at the promoted address at submission time (CNAME Verification Evidence) belongs to the binding's intent lifecycle — it is not ongoing DNS monitoring. Unbinding returns the promoted Platform Address to ordinary display; it deletes nothing and does not close public access.

### AP Public Access Health

An AP-owned read-side assessment of each Public Address's routing readiness, using states such as `progressing`, `verifying`, `accessible`, and `blocked`. It is routing health, not application response monitoring: workload 404/500 responses do not make a Public Address unhealthy. An AP with no Public Address intent has no entries — absence of public access, not a blocked state.

_Avoid_: AP Public Access Node health, standalone public access monitor.

### AP Public Access Node

A presentation-only Project Canvas node derived from an AP's Public Addresses (user-visible label: Public access). Not a Brain product resource, backend API view, Kubernetes resource, or Settings Owner.

### AP Network Settings

The AP-owned settings area for App Listening Ports, Private Addresses, Public Addresses, Platform Addresses, and Custom Domain Bindings — one AP Settings Draft domain regardless of which Settings View shows it. Its public-routing section (the Domain List) lists Public Addresses with their routing state, and Public Address edits may add App Listening Ports within the same draft.

## Database

### DB (Database)

A Brain product resource that represents a managed database workload available to APs in the same Project.

### DB Service

The user-facing database service represented by one DB resource and one database node on the Project Canvas. A DB Service may expose multiple engine-level Logical Databases through DB Access.

### Logical Database

An engine-level database namespace inside one DB Service — a PostgreSQL, MySQL, or MongoDB database, or a Redis database index. An object browsed inside DB Access, not a Project Canvas DB resource.

### DB Instance Preset

A user-facing resource-size choice for DB Deployment Settings, each mapping to one DB quota value. Internal SKU-like labels such as `db.mysql.small` are not primary UI language.

### DB Service Backup

A named recovery point for an entire DB Service (manual or automatic), belonging to the service rather than one Logical Database. Deleting a backup removes only that recovery point, not the source service or anything restored from it.

### DB Service Backup Policy

The automatic backup rule for one DB Service — at most one current policy, defining schedule and retention, distinct from the backups it creates. Disabling it stops future automatic backups but deletes no existing DB Service Backups.

### DB Service Restore

A non-destructive workflow that creates a new DB Service from a completed DB Service Backup; the source service is never overwritten or rolled back. The restored service appears in the same Project and becomes the user's next Project Canvas focus.

### DB Access

A resource workflow for inspecting — and where the product enables it, editing — one DB Service's objects and data without exposing its connection credentials. Distinct from DB Settings, which changes desired configuration. Its workspace is browser-local and per service: switching to another DB Service ends the session and reopening starts fresh with no retained tabs; within one service an object has at most one open view, whose interaction state lasts only while its tab stays open.

_Avoid_: Database connection, DB Terminal session.

### System Object

A Logical Database object provisioned by the database engine, an installed extension, or platform operator tooling rather than authored by the user. Not part of the user's data model: DB Access omits System Objects by default and shows them only on explicit request.

_Avoid_: operator object, internal table, system table.

## Database Binding & AP Environment

### Database Binding

A runtime dependency where an AP is configured to consume one DB's connection credentials.

### Pending Database Binding Intent

An unsaved AP Environment draft intent to create or update a Database Binding, derived from explicit AP Environment References — never inferred from ordinary user-authored DSN strings. Multiple references from one draft to the same DB Service collapse into one intent, and an AP-to-DB Connecting Edge is only a shortcut for creating the same intent. It may appear as a pending canvas edge, but it is not a Canvas Connection until saved resource state contains binding evidence.

### AP Environment Raw Source

The canonical AP environment editing model: the complete set of entries as the user can author them in `.env` form, including direct values, AP Environment References, and runtime expansions. Structured environment controls are views or insertion aids over the raw source, not separate saved state. Authoring can begin before the AP exists: a Docker Deployment Source carries its environment as a raw source and delivers it unchanged to the AP it creates. A deploy-time raw source holds no AP Environment References — references are available only in AP Settings.

### AP Environment Reference

A product-level expression in the AP Environment Raw Source that points at a DB Service-provided environment value. Resolved into ordinary entries before runtime, while the user-facing raw source may retain the expression.

### DB Connection DSN

A complete connection string for one DB Service, including any credentials the engine requires. Produced only by an explicit reveal or copy action — default DB read surfaces carry a DB Connection Template instead.

_Avoid_: credential-free DATABASE_URL.

### DB Connection Template

A credential-free connection string whose username and password segments are literal placeholders while address and database name are real. It identifies which DB Service a value points at without containing credentials, and is what DB read surfaces carry by default.

_Avoid_: masked DSN, redacted connection string.

## Settings

### Settings Owner

The resource whose desired configuration a settings surface edits — an AP or DB. Selecting an AP Public Access Node may open an AP-owned Settings View, but the node is never the Settings Owner.

### Settings Domain

A Settings Owner configuration partition that can be independently checked for conflicts, submitted as a Pending Settings Update, reconciled against observed resource state, and cleared when applied. Not a Settings Section, Settings View, or API field group.

### Settings View

A settings entry point presenting one named subset of a resource's settings surface, composed of one or more Settings Sections (coherent subsets of the owner's configuration). It remains part of that resource's settings surface and uses the same Settings Draft confirmation model as the full surface; neither views nor sections are standalone panes or Component Registry items.

### AP Settings

The primary UI surface for viewing and editing AP desired configuration, including image, resource capacity, Replica Strategy, environment, and network settings.

### DB Settings

The primary UI surface for viewing and editing an existing DB's desired configuration after it has been created.

### Settings Draft

A local set of pending AP or DB settings changes, submitted only when the user confirms the update. Discarding abandons the pending changes and keeps the settings surface open — it is not a cancellation of anything already submitted.

### Settings Submission

An in-flight settings write after the user confirms and before the product has accepted or rejected it. No longer an unsaved Settings Draft — the user may leave the settings surface — but not yet a Pending Settings Update.

### Pending Settings Update

A submitted settings change the product has accepted but the resource has not yet fully reflected. Leaving the surface warns about nothing; reopening presents the submitted target until the resource catches up or the user intentionally replaces it or adopts the latest observed configuration. It belongs to the Settings Owner and its Settings Domains, not the Settings View that submitted it — a narrow view and the full surface present the same target — and each domain's pending update clears independently as the resource catches up.

_Avoid_: saved draft, optimistic resource truth.

### Observed Settings Divergence

The condition where a domain's observed desired configuration changes to a value that is neither the submitted target nor what that target was submitted against. The user must choose to keep the submitted target or use the latest observed configuration — never an automatic overwrite.

## Authorization & Identity

### Workspace Actor

The verified human identity acting within a workspace namespace, established by cross-checking the request kubeconfig's live workspace access against the desktop-minted proof binding it to the global user id. Actor verification and namespace authorization are separate checks: one establishes who is acting, the other where that actor may act. A Desktop session user id, an unverified app-token claim, or a namespace-authorized workload ServiceAccount is not a Workspace Actor.

_Avoid_: Desktop user id, namespace member id.

## Deployment

### Deployment Task

A deploy workflow work unit for creating or changing Project resources from a Deployment Source into a Deployment Target, executed by one Deployment Runner and possibly producing Deployment Artifacts. Owned by the deployment domain, not by Chat: assistants may create or inspect tasks through tools, but the lifecycle, events, artifacts, and Deployment Task Timeline remain deployment records.

_Avoid_: deploy job, deployment request.

### Deployment Source

The user-provided origin or intent for a Deployment Task — a GitHub repository, Docker image, database choice, application template, or natural-language prompt. It describes what should be deployed, not where it lands.

### Deployment Target

The Project relationship selected before a Deployment Task starts: either a new Project created in the same flow or an existing Project that receives the deployed resources.

### Deployment Runner

The execution strategy for one Deployment Task: direct and template runners consume already-structured Deployment Sources, while an AI Runner interprets less-structured ones such as repositories or prompts.

### Deployment Artifact

A product resource description produced or selected by a Deployment Task for application into the Deployment Target — distinct from Deployment Source details and task progress messages.

### Deployment Task Cancel Request

A recorded user intent to stop an active Deployment Task, acknowledged cooperatively by the runner and resolved to `cancelled` by the engine when unacknowledged past its deadline. Cancelling stops the workflow; it never deletes or reverts applied resources.

_Avoid_: force kill, rollback, undo deployment.

### Redeploy

Recovery for a failed or cancelled Deployment Task: a new task cloned from the predecessor's Deployment Source and Deployment Target with recorded lineage, reusing result identities the predecessor already allocated. There is no in-place retry, and a GitHub Redeploy always binds the initiator's own GitHub Connection — it never inherits the predecessor's credential owner.

_Avoid_: retry, re-run, task restart.

### Deployment Action Actor

The Workspace Actor who initiates a Deployment Task or performs a collaborative action on it, such as cancellation, Blocking Input submission, or Redeploy. It describes who acted; it never transfers or replaces the task's Deployment Credential Binding.

_Avoid_: credential owner, task owner.

### Deployment Credential Binding

The immutable selection on a GitHub Deployment Task identifying the credential-owning Workspace Actor, that actor's GitHub Connection reference, and the binding version chosen at task creation. Collaborative actions never change it, and Redeploy resolves a new binding from its own initiator.

### Deployment Task Retention

The split lifecycle boundary between permanent Deployment Task history and its ephemeral execution runtime. Deployment Task rows, events, runner transcripts, and deployment results have no application-level retention deletion. A per-task Deploy Devbox is paused at a terminal outcome and deleted after 24 confirmed paused hours; the task then records `runtimeState=deleted`. There is no user-facing task deletion.

_Avoid_: task purge, clear history, archive task, Devbox retention as task retention.

### Template Instance Adoption

Claiming an already-applied Sealos Template Instance into Brain as a Project after the cluster already has the Instance. Brain creates the Project row and writes Brain bookkeeping labels onto the instance's namespaced resources; it does not inject `extraLabels` at create time (that remains the GitHub Deployment Task path). Namespace comes only from the request kubeconfig. Identity is the Instance UID, not the instance name — a reused name with a new UID is a new Project. The mapping's adopting/adopted/failed status is internal bookkeeping, never a user-visible Project status. Brain labels written here follow ADR 0027: they mark ownership, they do not classify AP or DB.

_Avoid_: import template, claim instance, extraLabels backfill, adopt as a Deployment Task.

### GitHub Connection

A personal OAuth authorization that lets one Workspace Actor list and deploy from their own GitHub repositories within a namespace — never a shared namespace credential another actor may select. Disconnecting forgets the connection locally; the GitHub-side authorization survives until revoked on GitHub, and account choice happens at connect time, never at disconnect.

_Avoid_: shared namespace GitHub credential.

### Docker Deployment Settings

The creation-time choices for a new AP before it exists: Docker image, launch command and arguments, environment, AP Configuration Files, AP Storage Mounts, App Listening Port, and whether to request a Platform Address. Independent of entry path; user-facing surfaces use Public Address or Network language, not Ingress language.

### DB Deployment Settings

The creation-time choices for a new DB before it exists — database engine, instance preset, and replica count. Independent of entry path: with a new Project or added to an existing one.

### Deployment Task Projection

A Project-scoped read-side view of one Deployment Task containing only the facts project surfaces need to present progress and resource handoff: its Deployment Projection Slots and Deployment Preview Edges. Project Canvas consumes projections rather than full task records, and a projection does not own Canvas Layout positions.

### Deployment Projection Slot

A task-local Project Canvas slot within one Deployment Task Projection: unknown while progress precedes structured result evidence, concrete once it carries the anticipated result identity used for Deployment Handoff — which is still not a Canvas Resource Identity. Only anticipated results that can become canvas resource nodes get slots; template support objects do not.

### Deployment Projection Footprint

The visual group of currently visible slots for one Deployment Task Projection — possibly AP, DB, AP Public Access Node, and template-visible workload slots from the same task. Each AP Public Access Node slot stays visually paired with its owning AP slot; the pairing guides generated placement and never overrides user-arranged placements.

### Deployment Projection Placement

The temporary, project-scoped visual position a Deployment Projection Slot owns before Deployment Handoff — a Canvas Layout placement that may be rekeyed to the resulting resource. A user-arranged placement is authoritative; a generated one is a system proposal refinable until a user arranges it.

### Deployment Placeholder Node

A temporary Project Canvas skeleton node for a Deployment Projection Slot without a live resource node. A task projection — not a resource, Settings Owner, action target, or Canvas Connection endpoint.

_Avoid_: ghost node, pending AP, pending DB.

### Deployment Preview Edge

A temporary visual relationship between slots of one Deployment Task Projection, requiring explicit preview facts such as generated AP-to-DB reference intent, template-declared dependency, or AP-to-public-access pairing — sharing one task is not enough. Not a Canvas Connection.

### Deployment Handoff

The transition where a concrete slot stops being a Deployment Placeholder Node and its matching result appears as a normal resource node, possibly rekeying the slot's placement to the resource when it has no existing position; it completes per slot while unresolved slots stay visible. When multiple slots offer incompatible placements to the same unplaced resource and no user-arranged placement unambiguously outranks the rest, task order decides nothing: the resource takes First Canvas Placement and the conflicting placements are consumed.

### Deployment Result Resource

A user-visible Project result a Deployment Task creates or changes — an AP, DB, AP-owned Public Address, or template-visible workload. Support objects may explain progress but are never result resources.

_Avoid_: applied object, Kubernetes object.

### Deployment Result Readiness

The condition where a task's user-visible result resources have become healthy enough for the task to count as complete — distinct from having applied Deployment Artifacts.

_Avoid_: apply complete, manifest applied.

### Deployment Timeline Step

A runner-defined user-facing step in a Deployment Task Timeline. One step may summarize several execution phases, and its identity stays stable throughout a run even as status, events, or result details change.

_Avoid_: backend phase, task status.

### Deployment Task Timeline

The user-facing progress view for one Deployment Task: runner-defined Deployment Timeline Steps plus Deployment Result Resource Cards once results are known. It belongs to the task, not a browser session or chat transcript.

### Deployment Result Resource Card

A Deployment Task Timeline section for one Deployment Result Resource, presenting its status and events within the task's progress. Blocked means the task can still proceed after an external action or changed condition; failed means the current run has ended for that resource. Required cards gate Deployment Result Readiness; optional cards may keep showing progress or warnings without blocking completion.

### Deployment Task Success Record

The conclusion a Deployment Task Timeline appends once Deployment Result Readiness is reached and every required entry probe has passed: the product is usable now. It carries only facts the deployment declared — product name, entry addresses, first-use steps — so the Timeline never presents an address or an instruction the runner cannot evidence; a task with no required Deployment Result Resource publishes no record and keeps reporting progress. It is part of the task-owned timeline snapshot, not a Chat message or a toast, and its Timeline revision doubles as its identity.

_Avoid_: success toast, deploy done banner, completion notification.

### Deployment Celebration

The one-shot confetti that marks a Deployment Task Success Record arriving while the user is watching. It belongs to the mount that observed the transition and is claimed once per task plus record revision, so reconnects, duplicate snapshots, refreshes onto a finished task, and a second pane for the same success never replay it. Its lifetime is also the Timeline's auto-close window: the record is shown, celebrated, and then the pane closes.

_Avoid_: success animation state, confetti on completed.

### Deployment Failure Reason

The stable classification and corresponding user-facing action shown on a failed Deployment Timeline Step — the narrowest reason the engine can prove, `unknown` with the Task ID otherwise; safe to persist and aggregate, never a raw stack trace. Its expandable diagnostic context (Deployment Failure Detail) shows the scrubbed provider or Kubernetes error for direct/template runners, and for the AI runner only allowlisted fields — never a raw Gateway or command error. Three reasons are proven by a Billing Interruption judgment rather than by the runner: `balance-exhausted` (Account Debt on a Pay-As-You-Go workspace — the only kind the platform suspends for it), `subscription-expired` (a subscribed workspace suspended under a payment-due Workspace Subscription), and a resource-attributed `quota-exceeded` (a full Deployable Quota); the first two are also proven by the platform's own billing denial at the apply boundary — the one Billing Interruption the platform does signal — and then carry no Billing Evidence. When the judgment proves the reason it carries Billing Evidence; either way the failed step shows the billing callout while Redeploy stays in the pane footer, and the Deployment Task Dock chip carries the reason phrase.

_Avoid_: workspace not ready (for a suspended workspace), timed out (as the reason for a billing stop).

### Billing Evidence

The structured record of what the Billing Interruption judgment found behind a `balance-exhausted`, `subscription-expired`, or resource-attributed `quota-exceeded` Deployment Failure Reason — the available-balance formula's result, the expired subscription, or the quota that was full — safe for every runner to persist and show. It stands in for the runner's own error whenever that error was only a stall; the provider's own apply-time quota error keeps its numbers, and so does the platform's own billing denial. A billing reason proven only by that denial carries no Billing Evidence, and its callout speaks plan-neutrally.

_Avoid_: raw timeout text, stack trace, billing dump.

### Deploy Billing Notice

The advisory billing callout a deployment pane shows above a still-usable form while a condition dooms every deployment the workspace could start — Account Debt on a Pay-As-You-Go workspace, a full cpu/memory/pod Deployable Quota, or a payment-due Workspace Subscription — wearing the Billing Interruption's callout and CTA. It informs and never blocks: the deploy action stays enabled, and a run pressed through a correct notice fails at the platform and comes back explained as a Billing Interruption; the assistant's deploy tool alone still refuses, pointing the user at the pane. A low but positive balance never shows it, and a full storage or nodeport quota speaks through form validation instead — unless the pane's every deployment requests it, where the notice speaks (the database presets all carry storage).

_Avoid_: Deploy Billing Wall, billing wall, low balance warning, pre-flight check, deploy disabled.

### Deployable Quota

The workspace quota types a new workload consumes and the Billing Interruption judgment therefore inspects: cpu, memory, storage, pod, and nodeport — traffic and GPU stay out. Cpu, memory, and pod are spent by every deployment, so any of them being full dooms all deployment work and is voiced by the Deploy Billing Notice; storage and nodeport doom only workloads that request them and are voiced by form validation on the requesting fields — or by the Deploy Billing Notice in a pane whose every deployment requests them.

_Avoid_: resource quota (for this set), workspace limits, all quotas.

### Deployment Task Dock

A Project Canvas affordance presenting the current Project's visible Deployment Task Projections so users notice active or attention-needing deployment work and re-enter each task's Deployment Task Timeline. Chips carry no inline lifecycle actions — cancel and Redeploy live in the timeline pane a chip opens; terminal tasks additionally offer dismissal. Not deployment history, a task center, or a canvas node.

### Deployment Task Dock Dismissal

A personal acknowledgement of one Deployment Task Projection version in the dock, available only for terminal tasks. It suppresses that task's reminder for that user until the projection changes — not shared Project state, cancellation, or deletion.

_Avoid_: close task, delete task, mark complete.

## Project Runtime & Read Model

### Project Runtime

The Project-scoped read-side boundary project surfaces use to interpret current resource presentation facts and session-local launch context. Its Project Resource Read Model is presentation knowledge — never raw resource truth, Canvas Layout, editable Settings backing, or a resource action command bus.

### Settings Launch Context

Session-local Project Runtime memory of how one project surface entry was opened, carrying launch source and transient bridge intent for the current browser session only. Not route state or editable Settings backing: it may disappear without changing the restored Settings Owner or Settings View, and route restoration never restores bridge intent.

## Project Canvas

### Project Canvas Workbench

The single module that orchestrates the Project Canvas page — its actions, canvas, and surfaces — and is the test surface for that orchestration.

### Container Node

A canvas node that represents an AP workload. The name is retained as a product/UI term; it does not mean an individual Kubernetes container.

### Canvas Resource Identity

The product identity of a canvas node's backing AP, DB, or AP Public Access Node surface, keyed by `kind`, `namespace`, and `name` so Canvas Layout stays stable across short reconciliation gaps. Kubernetes UID is retained only as last-seen entity identity to detect when a same-named workload is meaningfully new; AP Public Access Nodes use AP-bound identity rather than their own UID.

### Resource Display Name

The human-facing name of one AP or DB, shown on its canvas node, its settings pane title, and in assistant conversation. A Template Instance owns none — the APs and DBs it spawns each carry their own, sharing the template's name as a common base. It is not chosen at creation: the platform derives a default from the resource's Deployment Source (Docker image, DB engine, or template name) at deploy time and resolves collisions itself; users can rename it afterwards. A resource carrying no stored name shows its Kubernetes name; a name, once stored, cannot be cleared back to it. Unique within a Project (trimmed); an AP Public Access Node shows its AP's Resource Display Name rather than owning one. Never a selector or identity — stable identity is Canvas Resource Identity, and destructive confirmations additionally show the Kubernetes name.

_Avoid_: node name, resource name (that is the Kubernetes `metadata.name`), custom name.

### Canvas Layout

The Project-scoped visual arrangement of the canvas, shared by everyone who opens the Project — the single authoritative placement store, keyed by Canvas Placement Owners rather than rendered node instances. A resource-owned placement survives transient read-model absence for a grace window (Missing Resource Layout Grace); only continuous absence beyond it may remove the placement.

### Canvas Placement Owner

The stable Project Canvas identity that owns one visual placement — a real resource or a Deployment Task projection. Both kinds live in the same Canvas Layout, and a deployment-owned placement does not make the projection a resource.

### Incremental Canvas Placement

The placement rule for canvas items without a Canvas Layout position: it proposes a deterministic Generated Canvas Position, preferring anchors that reflect resource relationships before global open space, and saves only the newly placed nodes. Nodes from one user workflow or with direct relationship evidence are placed together as a group, without binding their later movement. A user-created or user-moved placement (User Canvas Placement) is authoritative over generated placement, Deployment Handoff, and this rule; existing positions are never recalculated — this is not whole-canvas auto-layout. First Canvas Placement, the first persisted position for an owner, is used only when neither a resource-owned nor an inheritable deployment-owned placement exists.

### Canvas Viewport Focus

A temporary, per-view viewport adjustment that keeps a target canvas node visible within the currently available canvas area (excluding covering surfaces such as a Side Pane) without changing Canvas Layout. Deployment task focus is one-shot — on explicit task re-entry or a focus target's first appearance; routine timeline streaming must not keep moving the user's viewport.

### Canvas Connection

A canvas edge representing an established runtime dependency between resources, derived from saved resource state. Removing Database Binding evidence in an unsaved AP Environment draft does not remove or hide an established connection before the update succeeds.

### Connecting Edge

A temporary canvas interaction created when a user drags a line between canvas nodes. It becomes a domain command only when its endpoints match a supported resource relationship, regardless of drag direction.

## Resource Actions & Affordances

### Resource Action

A user-triggered command that changes an existing AP or DB resource's state — start, stop, restart, delete, toggling DB public access. It belongs to the target resource, not the Project Canvas or the surface that launched it.

_Avoid_: Canvas Action, node action.

### Resource Surface Intent

A user-triggered intent to open a resource-focused project surface for an existing AP or DB — Resource Logs, AP Terminal, DB Terminal, DB Access, AP Image Versions, or a Settings View. It belongs to surface orchestration, not the resource lifecycle; it is not a Resource Action because no resource state changes.

### Resource Affordance

A user-facing entry point fronting either a Resource Action or a Resource Surface Intent, belonging to the target resource rather than the surface showing it. Each target kind has a stable affordance family — mutually exclusive lifecycle entries resolve by resource state, and kinds without an established family gain no placeholder entries for menu parity.

### Unavailable Resource Affordance

A Resource Affordance that applies to the target conceptually but cannot be used in the current project, session, resource state, or platform capability. It stays visible with a user-facing reason in product terms (read-only access, busy resource state, unsupported capability, missing configuration, …) rather than being hidden; it is not a placeholder for unshipped roadmap capability.

_Avoid_: hidden unsupported action, missing menu item.

## Project Surfaces

### Side Pane

A non-modal, temporary project surface for focused work such as resource inspection, settings, or deployment flows — distinct from the persistent Project Assistant Pane. Its pinned footer carries pane-level actions chosen by the hosted surface, not by the pane; a surface without pane-level actions has none.

### Main Action Surface

A temporary project surface occupying the project main area for focused resource work — not a right-side inspection surface like a Side Pane.

### Session Drawer

A bottom temporary project surface for one interactive resource session, such as an AP Terminal or DB Terminal. It may stay open while the user inspects details in a Side Pane.

### Project Assistant Pane

The persistent right-side project layout region hosting assistant chat and related controls. It can trigger Side Panes but is not itself a Side Pane.

## Sessions & Observability

### AP Terminal

An interactive terminal session that opens a generic pod shell on an AP workload — a workload shell, unlike the DB Terminal's database engine-client session.

_Avoid_: AP Console, console.

### DB Terminal

An interactive session running a DB Service's native engine client — `psql`, `mysql`, `mongosh`, `redis-cli` — for ad-hoc read-write commands. Distinct from DB Access's structured workflow; usable only while the service runs and only for engines with a supported client, otherwise presented as an Unavailable Resource Affordance rather than omitted.

_Avoid_: DB Console, console.

### Resource Logs

A read-only Main Action Surface for timestamped runtime output of one AP or DB Service — observation, not interactive commands. Always in exactly one of two states: a Live Log Window, anchored to the present and following new output across the trailing relative span, or a Frozen Log Window, anchored to fixed wall-clock bounds that never move — entered by pausing (which materializes the bounds) or applying an absolute range, and always described by its actual start and end.

### Workload Telemetry Series

A normalized time series of workload resource usage for AP and DB workloads, presented in metrics panels only as a live trailing window whose leading edge is the present — unlike Resource Logs there is no frozen counterpart. Its latest-point summary (Workload Telemetry Snapshot) feeds compact node presentation and is observational data, not lifecycle state or canvas topology.

_Avoid_: frozen metrics window, custom metrics range.

### Workload Telemetry Authorization

The access decision for workload telemetry: a caller may read a workload's telemetry only if it can read that workload's backing object under its own credentials — per workload, not per namespace; a parseable kubeconfig is never sufficient. A denial is indistinguishable from an absent workload, so it never reveals whether another tenant's workload exists.

_Avoid_: namespace access check, metrics permission.

## Assistant & Billing

### Assistant Conversation

A private assistant chat thread owned by the Workspace Actor who started it and
addressed by one explicit stable target: either workspace scope
(namespace, userUid, scope_kind=workspace) when no Brain Project is active, or
Project scope (namespace, userUid, scope_kind=project, projectId) inside one
Brain Project. A foreign-actor or foreign-scope conversation is
indistinguishable from a missing one. Entering a Project therefore switches to
that Project's own thread list rather than reusing workspace or another
Project's history. Legacy rows without an explicit scope remain stored but
belong to no scope and are not guessed into one. Personal and scope-local,
unlike namespace-shared Canvas Layouts, Deployment Tasks, and Free Chat Turns.

_Avoid_: shared namespace chat, per-namespace chat history, cross-Project chat history.

### Chat Billing Mode

Who pays for one assistant model call: `free` spends a Free Chat Turn through the platform Chat Agent connection, while `user` bills the caller's AI Proxy. The server decides per turn and client surfaces render the mode without deriving it. Only an Active Free Trial workspace can enter `free`; after its allowance is exhausted it hands off to `user`. Paid plans, Pay-As-You-Go workspaces, PAUSED Free workspaces, expired trials, and a deployment with no complete platform Chat Agent connection use `user` from their first turn with any allowance unspent. A `user` turn spends a Paid Source; an exhausted one is refused by the Paid Chat Wall before the turn, or told as a Billing Interruption when the AI Proxy refuses a turn already under way.

_Avoid_: subscription tier, plan.

### Paid Source

What a `user` Chat Billing Mode turn spends: a subscribed workspace's AI Credits, or a Pay-As-You-Go workspace's Account Balance. The server names it with every turn so a refusal can say which one ran out and which fix applies (upgrade the plan, or top up).

_Avoid_: wallet, credits (for a PAYG workspace), balance (for a subscribed workspace).

### Paid Chat Wall

The pre-send refusal of a `user` turn that has nothing to spend: a billing callout in the card slot naming the fix, and a locked composer stating why. Its cause is an exhausted Paid Source (AI Credits, or the Account Balance in Account Debt) or a plan that grants no AI allowance at all — the platform Free plan carries none, so an Active Free Trial that spends its last Free Chat Turn meets the allowance cause, not a spendable source. Every cause locks at once. The allowance cause is the one chat surface that says "plan" ("AI usage not included", `allowance-plan`): the Subscription Plan itself is the cause, so naming it is the truthful fix, and Chat Billing Mode's avoidance of the word stands everywhere else. Still the only Chat Billing state that locks the composer — a Billing Interruption behind an error card locks nothing, because the next send re-gates.

_Avoid_: paywall, quota exceeded (for chat), chat disabled.

### Free Chat Turns

A platform-funded allowance of Chat Agent turns per namespace (user-visible label: Free trial messages), spendable only during the workspace's Active Free Trial through `SYSTEM_OPENAI_API_KEY` and `SYSTEM_OPENAI_API_BASE_URL`; a turn is reserved when it starts and returned if it fails, so only successfully completed turns stay spent. A lifetime entitlement counter — namespace-shared, never per-user, never reset — not a rate limit; exhausting it hands subsequent turns to `user` billing through the caller's AI Proxy, where a plan without an AI allowance is refused by the Paid Chat Wall's allowance cause (ADR-0073).

_Avoid_: free tier, trial credits, free assistant messages, free messages.

### AI Proxy

The per-cluster, OpenAI-compatible gateway (Sealos `aiproxy`) serving user-billed assistant turns against the user's own cluster account — distinct from its `aiproxy-web` token-management sibling. A `user`-billed turn calls it with an AI Proxy Token, a user-scoped API key minted from the caller's kubeconfig that authorizes and bills that one user; the token is neither a platform credential nor the kubeconfig itself.

_Avoid_: model provider, LLM backend, system token, platform key.

## Onboarding

### Onboarding Profile

The per-person survey record captured by the first-entry sampling dialog
(the user understanding loop). An Onboarding Profile belongs to the bare
global `userUid` — Brain's only namespace-less personal resource — so one
person holds at most one profile per region, regardless of workspaces
(ADR-0061).

_Avoid_: first-login record, workspace profile, per-workspace survey, user cohort row.

### Sampled

The terminal predicate on an Onboarding Profile: a person is Sampled once a
completed or dismissed record exists, and the sampling dialog never shows
again. Anything short of a terminal record — including an abandoned
mid-survey attempt — leaves the person Unsampled, and the predicate is
re-judged on every entry.

_Avoid_: has logged in before, first-login flag, seen-dialog cookie, survey done.

### Terminal Snapshot

The full set of confirmed answers a survey session carries on its terminal
action (submit or skip), making the resulting Sampled record complete on
its own — it never depends on the per-step best-effort saves having
survived. Only answers the person confirmed by advancing are part of the
snapshot; an unconfirmed selection or unsubmitted draft is not. A snapshot
never erases previously saved answers it does not itself carry.

_Avoid_: final sync, answer replay, batched answers, form dump.

### Onboarding Gate

The client-side judgment that decides whether the sampling dialog appears
for the current person. The Gate is opportunistic and non-blocking: the
console always renders, and the dialog appears only on a definitive
Unsampled verdict. Any unknown outcome — credentials never arriving, a
failed or unresolved status check — means the Gate silently stands down
until the next entry. Sampling is never bought at the cost of console
access, and the sampling dialog waits while a Billing Escalation Dialog is
open — money and deletion outrank a survey.

_Avoid_: login wall, blocking splash, mandatory interstitial, onboarding redirect.

### Cohort Tag

The stable machine-readable enum value recorded for a survey answer (e.g.
`real_business`), decoupled from display copy so a copy revision never
splits a cohort. Only first-order answers — what the person actually
selected or typed — are recorded as Cohort Tags; derived interpretations
(business intent, company context) are read-time computations and are never
stored.

_Avoid_: raw answer text, display label, derived segment column, business intent field.

## Account & Subscription

Account-level money and workspace subscriptions, owned by the platform's account-service and presented read-mostly in the Billing Area. This is a different concept space from Assistant & Billing above — the terms here describe real money and plan commitments, while Free Chat Turns are counted turns, not money — with exactly one one-way dependency: the assistant's free allowance takes its eligibility from subscription state (the Active Free Trial), never the reverse. Brain reads and operates on these facts through account-service; it stores no billing state of its own. What a user says about a billing action — a Cancellation Survey response, like a Notification receipt of a subscription change — is feedback about the fact, not the fact, and may live in Brain's own store.

### Billing Area

The product area under the `/billing` URL prefix where users manage the current workspace's Workspace Subscription and inspect costs, usage quota, and pricing. It is entered from a single entry — the Billing row in the App Sidebar's account popover — and presented as one surface with Plan, Costs, Usage, and Pricing tabs; the Plan view is the area's index and the landing point of a Stripe Checkout Round-Trip.

_Avoid_: cost center, billing app, separate billing pages.

### Billing Region

One entry in the platform's global region catalog served by account-service: a cluster identified durably by an opaque uid and addressably by a unique domain. account-service stores each Workspace Subscription under the workspace plus the Billing Region's domain, so every subscription query and payment action is region-addressed. The catalog's order carries no meaning — no position in it designates any particular region.

_Avoid_: cluster (when the billing catalog entry is meant), zone, first region.

### Current Region

The Billing Region this Brain deployment belongs to. It is a deployment-declared fact — stated by configuration and verified against the region catalog, never inferred from catalog order or guessed. If the declaration is missing or matches no catalog entry, the Billing Area refuses to render rather than show another region's answers: a wrong Current Region silently misprices workspaces as Pay-As-You-Go and directs payments at the wrong region.

_Avoid_: first region, default region, regions[0].

### Account Balance

The user's account-level funds held by account-service, presented as the available amount: balance minus accumulated deductions, plus every usable credit — Gift Credit and any plan-granted credit alike — the same formula the platform's own debt pipeline judges an account by, so the number a user sees and the number that suspends them never disagree. Account Balance is a composite: prepaid cash (the rechargeable part, able to offset subscription charges) plus promotional credit that is not cash. It is account-scoped, not per-workspace, and read-only in Brain — recharging it is not a Brain capability. It is not a Free Chat Turns count, a quota, or an entitlement counter.

_Avoid_: credits, wallet, free balance, top-up balance.

### Gift Credit

Promotional money the platform grants to an account — the new-user gift is the canonical case — consumed by metered usage before paid funds and expiring on a platform-set date. Gift Credit is account-scoped and counts toward the available Account Balance; while any remains, the Balance display names it so its silent burn-down is visible. It is not AI Credits (a workspace allowance for AI usage) and not cash: it cannot be topped up, transferred, or refunded.

_Avoid_: bonus, voucher, trial balance, free balance.

### Subscription Plan

A platform-defined subscription offering — name, price, cycle, and included resource quotas — served by account-service's plan catalog. Subscription Plans are shared catalog facts; a workspace's committed choice of one is its Workspace Subscription. Free Chat Turns ride the Active Free Trial rather than the plan catalog: no Subscription Plan lists them as a quota, and Chat Billing Mode still avoids the word "plan".

_Avoid_: tier, package, chat plan, pricing row.

### Plan Picker

The plan selection surface: Subscription Plan cards plus the additional-plans selector, shown identically wherever the user chooses a plan — the Pricing view's plans area and the Plan view's plan-change dialog render the same picker. Choosing an actionable plan hands off to checkout — either the quote or the downgrade confirmation; the picker itself never takes payment. Payment wait is not a third destination: the quote surface enters it in place once the user confirms, keeping the order summary and payment method on screen while the payment settles. On Pricing, the plans area may sit under a multi-option view switcher (for example when metered price table and calculator are available) or be the only Pricing content with no switcher chrome.

_Avoid_: plan catalog, plan list, plan cards section, Subscription plans tab (as the name of the surface).

### Workspace Subscription

The account-service-owned binding of one workspace to its current Subscription Plan, including lifecycle state (active, cancelling, pending upgrade, payment-due) and its most recent transaction. Cancelling means the user has cancelled but the paid period still runs; payment-due means the subscription has expired — a failed renewal charge and a cancelled period reaching its end both land here — and the workspace sits suspended under the Deletion Countdown. Payment-due outranks cancelling when both hold. A workspace has at most one; a workspace without one is Pay-As-You-Go. An upstream subscription record in DELETED status is not a Workspace Subscription — the workspace is Pay-As-You-Go and may subscribe anew. Users upgrade, downgrade, cancel, or resume it in the Billing Area; paid changes settle through a Stripe Checkout Round-Trip.

_Avoid_: account subscription, user subscription, namespace plan, workspace plan record, in debt (as a user-facing label), cancelled (as a lifecycle distinct from cancelling), deleted (as a client lifecycle).

### Cancellation Survey

The exit questionnaire inside the Plan view's cancel dialog, asking a user who cancels a paid Workspace Subscription which Cancellation Reasons apply and for optional free-text feedback. It collects; it does not bargain — no downgrade, pause, or discount is offered in it, and a retention offer, if one ever exists, is a separate concept. Every answer is optional and the survey never gates the cancel action: an empty submission cancels just the same, and dismissing the dialog is keeping the plan.

_Avoid_: retention flow, 挽留流程, win-back, exit offer, questionnaire (bare), unsubscribe survey.

### Cancellation Reason

One entry in the fixed, platform-defined list of why a user cancels, identified by a stable key that outlives its display wording; a user may select several per Cancellation Survey. It is a reason the user states, never one the platform infers.

_Avoid_: churn reason, cancel cause, feedback (for a selected reason).

### Pending Subscription Upgrade

An accepted Workspace Subscription upgrade backed by one unpaid invoice. Until the invoice is paid or cancelled, its target plan and checkout are authoritative and prevent creation of another upgrade payment; choosing any other plan routes through recovery — cancel the unpaid invoice, then continue with the newly chosen plan. Continuing payment also requires the upgrade not to be stale (see Stale Pending Upgrade).

_Avoid_: pending upgrade response, pending quote, new checkout.

### Stale Pending Upgrade

A Pending Subscription Upgrade whose target Subscription Plan has left the plan catalog. Its unpaid invoice must not be offered for payment anywhere — cancellation is the only recovery, after which any available plan may be chosen.

_Avoid_: retired-plan upgrade, orphaned upgrade, unavailable pending upgrade.

### Workspace Subscription Renewal

Recovery for a payment-due Workspace Subscription that exits the Deletion Countdown by choosing an available priced Subscription Plan and creating a replacement subscription. It may keep the same paid plan, but an unpriced Free Subscription Plan is not a renewal target.

_Avoid_: Free renewal, direct renewal charge.

### Renewal Time

The scheduled moment a Workspace Subscription's current paid period ends and the next automatic charge occurs — always the current period's end, wherever the label appears. It only exists while a renewal is actually coming: a cancelling subscription has none (its period end is a suspension date, voiced by the Deletion Countdown), and a payment-due subscription's Renewal Time lies in the past — the renewal that never happened. Distinct from Workspace Subscription Renewal, which names the recovery flow for a payment-due subscription, not this scheduled moment.

_Avoid_: expiry time (for the renewal moment), renewal (bare, for this moment), access-expiry timestamps as its source.

### Free Plan Expiry

What a Free Subscription Plan's current period end means: the moment the plan and its capacity end — nothing renews, resets, or is charged then, because the platform constructs every Free subscription as cancel-at-period-end. It is the trial's one meaningful date and surfaces say it in expiry terms ("expires", "ends") wherever a paid plan would speak of renewal or quota reset; a Free subscription therefore has no Renewal Time. The constructed cancellation flag alone cannot identify a cancelled subscription — a Free plan carrying it is a healthy trial (or a paused no-trial Free, which runs no period and has no date), not a cancelling one.

_Avoid_: quota reset (for a Free period end), renewal time (for a Free subscription), cancelled/cancelling (for the constructed flag on Free).

### Active Free Trial

The state of a workspace whose Free Subscription Plan is currently running its trial: a Free subscription in normal standing, as opposed to one born paused with no trial (a user's second and later workspaces) or one expired into the same payment-due pipeline as any paid plan. The sole eligibility gate for spending Free Chat Turns and for rendering the Plan view's free-allowance usage block; when the allowance is exhausted, Chat Billing Mode becomes `user` rather than extending trial eligibility.

_Avoid_: free workspace, trial period (for the state), Free plan (bare, for this state).

### Deletion Countdown

The platform's fixed grace timeline that starts the moment a Workspace Subscription expires: the workspace is suspended immediately, the warning escalates as the countdown runs, and the workspace's resources are permanently deleted when it ends. Both roads into expiry — failed renewal payment and cancelled-then-lapsed — join the same countdown. The Billing Area surfaces it as a destructive warning carrying the stage's next deadline — the suspension date while a cancelled subscription's paid period still runs, the deletion date once expiry has passed; renewing (or resuming, before expiry) exits the countdown.

_Avoid_: grace period (as the user-facing name), debt period, deletion schedule, paused (for the suspended workspace).

### Pay-As-You-Go (PAYG)

The billing mode of a workspace that has no Workspace Subscription: usage is metered and settled against Account Balance instead of a plan commitment. PAYG is orthogonal to the plan catalog — it is not a Subscription Plan and never appears in one; the platform merely reports it as the workspace's subscription type when no subscription exists. Surfaces that list workspaces rather than plans (such as a workspace subscription overview) may report PAYG as a workspace's billing state — that is reporting the mode, not a catalog entry. A PAYG workspace leaves this mode by subscribing to a plan, which is a new subscription — not an upgrade or a downgrade.

_Avoid_: PAYG plan, pay-as-you-go plan, free mode, plan named "PAYG".

### Account Debt

The state of an Account Balance that has fallen to or below zero — the platform's debt pipeline treats only a strictly positive available amount as in good standing: the platform suspends the account's PAYG workspaces and, if the debt persists, deletes their resources through its own escalating debt pipeline — separate from the Deletion Countdown, which belongs to Workspace Subscription expiry. An account that has never been billed is exempt: with zero lifetime deductions the platform's debt pipeline skips it, so a fresh zero-balance account stays in good standing and is never in Account Debt. The platform reports it on a PAYG workspace as a debt status with no subscription and no timestamps, so no suspension or deletion date can be stated for it. Recovery is restoring the Account Balance (a Desktop top-up), never a subscription action — an Account Debt warning must not speak of a subscription expiring or renewing, and because the platform suspends only PAYG workspaces for it, the warning is voiced only on a Pay-As-You-Go workspace — a subscribed workspace's zero balance is not spoken of as debt.

_Avoid_: subscription expired / plan expired (for a PAYG workspace), payment due (user-facing), negative balance (as the state's name), arrears.

### Billing Interruption

A deployment or a paid assistant turn the platform stopped because the workspace hit its money or quota wall — Account Debt, a payment-due Workspace Subscription, a full Deployable Quota, or an exhausted Paid Source. The platform signals it at one seam only — its billing denial of a deployment's apply — and otherwise it is judged after the fact from the workspace's billing standing; either way it is told as a billing callout: the truthful cause and the CTA to the fix (top up, renew, or upgrade — a quota callout leads with the plan and keeps View usage beside it). The same judgment made before the action is the advisory Deploy Billing Notice before a deployment and the refusing Paid Chat Wall before a paid turn — deploy advises because its failure comes back explained, chat walls because a spent turn has no after-the-fact scene.

_Avoid_: outage, something went wrong on our side, timed out (as its name), billing error (as the concept's name).

### Subscription Payment

One recorded charge on the account's payment ledger for workspace subscriptions. Payment history and the Billing Area's income series are Subscription Payment lists filtered to paid records; Brain reads the ledger and never writes it. A Subscription Payment is money movement, distinct from metered Consumption Cost. The ledger is account-global, but every Subscription Payment belongs to exactly one region — the Billing Region of the workspace it paid for; a payment ledger read must attribute before it aggregates.

### Region Cost

The Costs view's headline total, scoped to the Current Region: the region's Consumption Cost plus the Subscription Payments attributed to the region's workspaces. Every number in the Costs view — the total, the workspace breakdown, the subscription list, and the trend's income series — speaks this one scope, and the workspace children sum to the parent. Money belonging to other regions' workspaces is out of this view entirely, never blended into a total its breakdown cannot explain.

_Avoid_: total cost (as an account-global figure on the Costs view), all-region total.

_Avoid_: recharge, top-up, charge record.

### Consumption Cost

The metered cost of resource usage recorded by the platform's billing pipeline, read per workspace, per app, or as a trend series. Consumption Cost is usage-derived spending presented in the Costs view; it is not a Subscription Payment and not a quota.

_Avoid_: recharge history, usage quota, bill (ambiguous).

### AI Credits

The workspace's consumable AI-usage allowance, granted by its Workspace Subscription each billing cycle and burned down as AI calls are charged. Account-service tracks it as money in micro-units and reports a single total/used pair per workspace; users see it at the platform's fixed rate of 1 AI Credit = 0.01 currency units. AI Credits are workspace-scoped and subscription-only — a PAYG workspace has none, its AI usage settles against Account Balance. They are not Account Balance, not Free Chat Turns, and not a quota: a quota is a capacity ceiling that frees up when usage stops, AI Credits are a balance that stays spent.

_Avoid_: AI quota (backend field name, never user-facing), AI balance, credits (unqualified), tokens, points.

### Stripe Checkout Round-Trip

The escape-and-return journey of a subscription payment: Brain leaves the desktop iframe to Stripe-hosted checkout (top-level redirect, or a new tab for upgrades while the original iframe polls the pending transaction) and returns through the desktop's Stripe callback, which routes back into Brain's Billing Area using the originating-app identifier the payment request declared. The return is a trusted redirect parameter, not a payment-status verification.

_Avoid_: payment popup, in-place payment, webhook return.

### Billing Currency

The cluster-level display currency for the Billing Area, delivered server-side per request rather than baked into the client bundle at build time, so per-cluster configuration takes effect at runtime.

_Avoid_: user currency preference, build-time currency.

## Notifications

### Notification Center

The user's single inbox for Notifications, opened from the App Sidebar's Notifications entry (below the Projects row). Global across every Project in the current workspace rather than belonging to one: every Workspace Actor sees the same messages, and only read state is personal. It is not the Deployment Task Dock and does not manage running tasks; it holds messages, not work.

_Avoid_: task center, activity feed, message center, alerts panel.

### Notification

One message addressed to the current user in the Notification Center: a billing, subscription, or quota event, or a platform announcement, each carrying a Notification Severity. Persistent and individually read/unread — read state is per message and per user, never a workspace-shared fact — which distinguishes it from a toast (ephemeral feedback that vanishes on its own); a Notification names its source Project when it has one. A Notification originates from the platform or from Brain itself; the two read identically in the Notification Center, though a platform-origin message may be withdrawn or revived by the platform when its underlying condition changes.

_Avoid_: alert, toast (for persistent items), event (for the user-facing message).

### Notification Severity

How much a Notification's message matters to the reader, on three levels — **critical** (something is already suspended or faces deletion), **warning** (a threshold was crossed or a deadline approaches; action prevents the next stage), **info** (a receipt, a hint, or an announcement; nothing to fix). Derived from what the message is about, never chosen per message, and shown in the Notification Center without visual escalation: a critical item is marked, not shouted — the Billing Escalation Dialog, not the list, is where a critical platform stage is announced.

_Avoid_: priority, importance (the platform CR field), level, tone.

### Status Hint

The one banner at the top of the content area that explains a billing state while it holds — payment-due (under the Deletion Countdown), Account Debt (on a Pay-As-You-Go workspace only — the same judgment as the Deploy Billing Notice, so the banner and the notice can never disagree), a full workspace quota, or an Active Free Trial about to end — and offers the way out. It is a state, not a message: it appears and vanishes with the condition, writes nothing to the Notification Center, leaves announcing a stage change to the Billing Escalation Dialog, and only the most severe holding state shows. The destructive states cannot be dismissed; a dismissed quota or trial hint stays hidden until its state ends and re-enters.

_Avoid_: alert bar, global notification, sticky toast, warning strip (as the concept's name).

### Billing Escalation Dialog

The one dialog that announces a step up the platform's debt ladder — a critical Notification the platform has just written, or revived as unread, with its popup flag set — wherever the Status Hint is mounted, on entry and mid-session alike. It speaks only for stages that already suspend or threaten deletion (Account Debt's suspension and scheduled-deletion stages, and every payment-due stage under the Deletion Countdown); the low-balance warning tiers stay in the Notification Center. The suspension and deletion-approaching payment-due stages carry the Deletion Countdown's next deadline, the same date the Status Hint states; the final-deletion stage names no date, since the derived deadline has already passed by then and the platform may delete at any time; an Account Debt stage states no date, since the platform gives none. It obeys the Account Debt voice rule — the account ladder is announced only on a Pay-As-You-Go workspace — and shows one stage at a time: the newest, whose dismissal marks it and every other unread stage of the same ladder read, because a newer stage supersedes an older one; that read mark is the same one the Sealos Desktop writes, so a stage dismissed in either place is dismissed in both. It is an event, not a state — the Status Hint keeps carrying the state beside it — it never blocks (closing is always available and nothing is locked), and it outranks the Onboarding Gate's dialog, which waits for it to close.

_Avoid_: debt popup, 欠费弹窗 (as the concept's name), billing alert, billing modal (bare), suspension dialog, low-balance popup.

## Design System

### Component Registry

An internal catalog for reusable UI components in the product design system — not complete product surfaces, panes, or workflows. A Registry Component may carry product vocabulary but must be driven by a host surface and must not own a complete product workflow or settings lifecycle.

_Avoid_: Pane Registry, Flow Registry.

### Canvas Glow

The dark material shared by immersive product surfaces: a near-black canvas base with a soft blue luminous wash floating above the surface's content. A surface or overlay adopts Canvas Glow as its material — "surface" itself always names a place, never a look. Carried by the Billing Area, its app cost drawer, and its plan-change dialog, and by the canvas action surface.

_Avoid_: surface style (when meaning the material), canvas material, glow overlay.

### CTA Chip

The one visual recipe for a call-to-action on a notification surface — Notification Center cards, the Status Hint, the billing callout family, toast actions: a small chip washed in the surface's own tone color, defined once in the design system's shared button and only tinted by its host. The chip never picks a hue of its own, so severity stays marked, not shouted; a notification renders at most one chip, an optional quiet sibling beside it, and a dismiss.

_Avoid_: CTA button (for the recipe), pill, tag, badge.

## Dev Tweaks

### Panel Posture

How the open dev tweaks panel occupies the viewport: **float** (a draggable corner card) or **frame** (the page docks as an inset card and the panel fills the freed strip). A user preference remembered across sessions. Not the same axis as Panel Mode.

_Avoid_: panel mode (for float/frame), docked mode.

### Panel Mode

How the dev tweaks panel is mounted by the host: **popover** (a top-layer overlay toggled with a hotkey) or **inline** (rendered in place as ordinary page content, always open, with no posture). A mount-time choice, not a user preference.

_Avoid_: posture (for popover/inline).

### Launcher

The collapsed bubble that stands in for the closed dev tweaks panel in popover mode. It can be pinned always-visible or shown only while some tweak deviates from its default (dirty indicator). An enabled Dev Mock counts as dirty and puts the Launcher in its mock form: instead of the neutral bubble, a capsule naming the mode and counting the enabled Dev Mocks.

_Avoid_: indicator capsule, FAB (for the Launcher itself).

### Dev Mock

A dev/demo-only mode in which a feature's API answers are served from fixtures according to the selected Mock Scenario. One Dev Mock answers for every surface that derives from the same facts — the billing mock also serves the billing-born Notifications and, through them, the Status Hint — so those surfaces can never disagree; surfaces with unrelated facts (platform-origin Notifications, a Deployment Task Timeline, a Conversation) get Dev Mocks of their own, and independent Dev Mocks compose. Its state lives outside the dev tweaks panel — the panel is only its remote control, never the source of truth — which separates it from a tweak, an override value the panel owns. While a Dev Mock is enabled, the pages it covers show fixture data, not real state.

_Avoid_: mock group, mock tweak, mock override.

### Mock Scenario

The named state one Dev Mock session is in (e.g. a subscription state). Selecting a scenario shapes every answer the mock serves; the serving side may advance the scenario after a successful write so whole flows can be walked through.

_Avoid_: mock preset, mock case.
