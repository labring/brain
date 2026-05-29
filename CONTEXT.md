# Domain Context

## Ubiquitous Language

### EntryPoint

A Crossplane XRD resource (`example.crossplane.io/v1`, kind `EntryPoint`) that represents the **allocated public routing layer** for an AP. Each EntryPoint is 1:1 associated with an AP via `spec.apRef`.

EntryPoint is **automatically created by the AP Composition** (via provider-kubernetes Object) when the AP has allocated public routing targets, and automatically deleted when the AP is deleted. A Requested Platform Address may remain pending before an EntryPoint exists.

EntryPoint manages:

- **Public Addresses** — externally reachable URLs/domains for the AP, each targeting an App Listening Port.
- **Custom Domain Bindings** — DNS verification, routing, and TLS certificate lifecycle for user-owned Public Addresses.

Not to be confused with: App Listening Ports (container ports where the application accepts traffic), AP endpoints (the raw legacy `spec.endpoints` on the AP resource), or Ingress (which is the underlying K8s resource created by Compositions).

### App Listening Port

An AP container port where the application accepts traffic for a Private Address or Public Address.

### Private Address

The single cluster-internal URL shown for an AP, targeting one App Listening Port.

### Public Address

An externally reachable URL/domain alias for an AP that targets one App Listening Port.

### Platform Address

A system-assigned Public Address that the platform can create without user DNS or certificate setup; in v1, users request one by choosing an App Listening Port, not by providing a host or URL. A Platform Address may be promoted into the CNAME target for a Custom Domain Binding, after which its host remains the binding target rather than the primary displayed Public Address.

### Requested Platform Address

A v1 Platform Address desired entry in AP `spec.input.network.platformAddresses[]`. It has a stable Platform Address ID and target App Listening Port, but no platform-allocated host or URL yet.

### Allocated Platform Address

A Platform Address whose host and URL have been assigned by the platform and published through AP observed network state.

### Reachable Public Address

A Public Address whose allocated host resolves and successfully routes external traffic to the target App Listening Port. Business-level HTTP errors from the workload do not make the Public Address unreachable; DNS failure, TLS/connectivity failure, or routing to the wrong backend does.

### Custom Domain

A user-owned Public Address for an AP. A Custom Domain reaches an App Listening Port through a Custom Domain Binding.

### Routing Scope

The public routing boundary within which one Custom Domain can belong to only one AP. In v1, the enforceable Routing Scope is the current Kubernetes namespace; broader cluster-wide uniqueness requires platform-level admission or indexing.

### AP (Application)

Crossplane composite resource (`example.crossplane.io/v1`, kind `AP`) that composes Deployment + Service(s), and optionally public Ingress + EntryPoint resources when the AP has allocated Public Addresses. Owns compute, App Listening Ports, one Private Address, and Platform Address allocation requests.

### AP Settings

The primary UI surface for viewing and editing AP desired configuration, including image, resource capacity, Replica Strategy, environment, and network settings.

### Docker Deployment Settings

The creation-time choices for a new AP before the AP exists, including Docker image, runtime environment variables, App Listening Port, and whether to request a Platform Address. Docker Deployment Settings create an AP workload from an existing image, are independent of entry path, and should use Public Address or Network language rather than Ingress language in user-facing surfaces.

### Docker Deployment Target

The Project relationship selected for Docker Deployment Settings before AP creation. A Docker Deployment Target is either a new Project being created in the same flow or an existing Project that will own the new AP.

### EntryPoint Public Addresses Panel

A narrow UI surface opened from an EntryPoint selection that presents the associated AP's Public Addresses. It is scoped to public routing and is not the full AP Settings surface.

The panel can open for an AP-derived pending EntryPoint selection before a real EntryPoint resource exists, because the user's public routing intent belongs to the associated AP's Public Addresses. It includes Platform Address rows and Custom Domain rows, and does not present the AP's Private Address.

Edits made from the panel use the same Settings Draft confirmation model as AP Settings.

The panel title is anchored on the associated AP name, even when the EntryPoint resource has its own name or has not been created yet.

After the last Public Address is removed, the panel may remain open as an AP-bound Public Addresses settings surface even though the EntryPoint node disappears from the canvas.

The panel closes when the associated AP no longer exists.

When no Public Addresses remain, the panel shows an empty state and still allows adding a Public Address. Public Address behavior in this panel matches AP Settings Public Address behavior.

### AP Replica Strategy

The AP configuration choice for how many workload replicas should run: either a fixed user-selected count or Elastic Scaling within user-selected bounds.

### Fixed Replicas

An AP Replica Strategy where the user selects one desired replica count and the platform keeps the AP at that count.

### Elastic Scaling

An AP Replica Strategy where the platform automatically adjusts AP replicas between a user-selected minimum and maximum based on one selected resource utilization target.

### DB (Database)

Crossplane composite resource (`example.crossplane.io/v1`, kind `DB`) that represents a managed database workload available to APs in the same Project.

### DB Service

The user-facing database service represented by one DB resource and one database node on the Project Canvas. A DB Service may expose multiple engine-level Logical Databases through DB Access.

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

A local set of pending AP or DB settings changes that is submitted only when the user confirms the panel-level update.

### Database Binding

A runtime dependency where an AP is configured to consume one DB's connection credentials.

### DB Access

A read-only resource workflow for inspecting one DB Service's objects and data without exposing its connection credentials. DB Access is distinct from DB Settings: DB Settings changes a DB's desired configuration, while DB Access explores the Logical Databases and objects exposed by that DB Service.

### DB Access Session

One active DB Access browsing session for a single DB Service. A DB Access Session keeps object selection and open object tabs while browsing multiple Logical Databases within that DB Service, while closing DB Access or switching to a different DB Service starts a separate session.

### DB Console

An interactive session that runs a DB Service's native engine client — such as `psql`, `mysql`, `mongosh`, or `redis-cli` — for ad-hoc, read-write commands against that DB Service. A DB Console is distinct from DB Access: DB Access is a read-only browser over a DB Service's objects and data, while a DB Console is a full interactive engine-client session. It is offered only for engines that ship a supported client and only while the DB Service is running.

_Avoid_: using "console" to mean the AP container shell. The AP node's terminal opens a generic pod shell on the AP workload, not a database engine client; the shared "console" label across AP and DB nodes does not denote the same kind of session.

### Container Node

A canvas node that represents an AP workload. The name is retained as a product/UI term, but it does not mean an individual Kubernetes container.

### Canvas Layout

A Project-scoped visual arrangement of the canvas, shared by everyone who opens that Project.

### Canvas Resource Identity

The product identity of a canvas node's backing AP, DB, or AP-bound EntryPoint surface. Canvas Resource Identity is keyed by `kind`, `namespace`, and `name`, which keeps Canvas Layout stable across short reconciliation gaps.

For AP and DB nodes, `name` is the Kubernetes resource name. For EntryPoint nodes, `name` is the associated AP name: the node represents that AP's Public Addresses surface, including the pending state before a real EntryPoint resource exists. Real EntryPoint `metadata.name`, `metadata.uid`, and status are observed resource facts attached to that surface, not the stable Canvas Resource Identity.

Kubernetes UID is retained separately as the last-seen entity identity so the UI can detect when a same-named AP, DB, or observed EntryPoint resource is meaningfully new.

### AP-bound Surface Key

The EntryPoint selection identity used by URL state and the Canvas Resource Pane. An AP-bound Surface Key is stable for `{ namespace, apName }` and selects the AP's Public Addresses surface, whether the real EntryPoint resource already exists or is still pending.

The AP-bound Surface Key is not the same thing as the Canvas Layout resource key. Canvas Layout uses Canvas Resource Identity. URL and pane selection may derive an AP-bound Surface Key from the same EntryPoint node facts, but the two keys are not interchangeable.

### Canvas Node Expansion State

The per-node expanded or collapsed presentation state of a canvas node card.

### Canvas Node Stack Order

The per-node visual layering order used when canvas node cards overlap.

### Canvas Connection

A canvas edge that represents an established runtime dependency between resources.

### Canvas Resource Pane

A right-side canvas surface opened from a selected AP or DB node to inspect or change resource-scoped details such as settings, metrics, logs, or history. It is distinct from the project assistant chat pane.

### Canvas Action Surface

A temporary canvas surface opened from a node action for focused resource work, occupying the project main area rather than the Project Assistant Pane. A Canvas Action Surface is distinct from a Canvas Resource Pane because it is not a right-side inspection surface and may host different action-specific experiences over time.

Within one project canvas, a Canvas Action Surface replaces the currently open temporary project surface instead of stacking with a Side Pane or Canvas Resource Pane.

A Canvas Action Surface follows the project main area's available width when the Project Assistant Pane is opened or closed.

### Side Pane

A non-modal, right-side temporary surface opened over the project main area to host focused project work. Side Panes share the same chrome and close behavior while their contents differ by purpose, such as Project creation, GitHub deployment, or Canvas Resource details.

A Side Pane is distinct from the Project Assistant Pane: the Project Assistant Pane is a persistent layout region for chat, while a Side Pane is a temporary surface triggered by a user action or assistant action.

Within one project surface, Side Pane is single-active: opening one Side Pane replaces the currently open Side Pane instead of stacking multiple Side Panes.

Different project surfaces may place a Side Pane differently. A canvas-oriented surface may overlay the Side Pane above the canvas, while a list-oriented surface may reserve layout space for the Side Pane. Placement does not change the Side Pane's shared chrome, close behavior, or single-active semantics.

A Side Pane is scoped to the currently visible project surface. Project Assistant Pane controls can open or replace the current surface's active Side Pane, but they do not own a separate assistant-specific Side Pane stack.

When a Side Pane contains unsaved user edits, closing it or replacing it with another Side Pane must first resolve the edit state. The user can stay on the current Side Pane, discard the edits, or save successfully before the Side Pane closes or is replaced.

### Project Assistant Pane

The persistent right-side project layout region that hosts assistant chat and related chat controls. It can trigger Side Panes, but is not itself a Side Pane.

### Connecting Edge

A temporary canvas interaction created when a user drags a line between canvas nodes. A Connecting Edge may become a domain command only when its endpoints match a supported resource relationship, regardless of drag direction.

### Workload Telemetry Series

A normalized time-series representation of workload resource usage for AP and DB workloads. It is consumed by both compact canvas node summaries and detailed metrics panels.

### Resource Logs

A read-only Canvas Resource Pane surface for inspecting timestamped runtime output emitted by one AP or DB Service. Resource Logs cover both AP and DB Service resources, default to the most recent hour, refresh only from explicit user/query changes, and are for recent/historical observation rather than an interactive command surface like the AP terminal or DB Console.

### Project Aggregate Status

A derived health tone for one Project row in the project list, computed from the phases of the Project's APs and DBs. It is not a field on the Project resource; it is computed in the UI from sibling workload lists. It expresses "are the workloads inside this project healthy", which is what users look at on the list, and is distinct from the Project composite's own `status.conditions[Ready]` (which only reflects whether the Project composition itself reconciled).

### Project Display Name

The human-facing Project name shown in navigation, project chrome, and project creation forms, preferred from `metadata.annotations.displayName` and falling back to the Project's Kubernetes resource name. It is unique within a namespace after trimming surrounding whitespace and comparing case-insensitively. Avoid using Project name to mean the Project's Kubernetes resource name unless the resource identity is the topic.

### Project Creation Pane

A non-modal right-side surface anchored in the project main pane for entering a new Project's initial user-facing identity and choosing how to create it before the Project resource exists. It is distinct from the Canvas Resource Pane and may coexist with the project assistant chat pane.

The Project Creation Pane may also open in a source-specific entry path. In a GitHub direct creation path, the user starts at GitHub repository selection rather than the general creation picker; the Project Display Name is derived from the selected repository and de-duplicated within the namespace. In a Docker direct creation path, the Project Display Name is derived from the Docker image repository name and de-duplicated within the namespace.

### Custom Domain Binding

The relationship that attaches a Custom Domain to an AP by promoting one Platform Address as the CNAME target. The AP owns the user's binding intent, while EntryPoint owns DNS verification, routing, certificate lifecycle, and binding health.

Unbinding a Custom Domain removes that relationship and returns the promoted Platform Address to ordinary display; it does not delete the Platform Address or close public access.
