# PRD: Brain project operating platform

## 1. Summary

This PRD defines the next product version of Brain, currently implemented in the `sealai` monorepo. The product goal is to help users create, deploy, inspect, and operate project resources from one workspace: Project Canvas, Deployment Tasks, AP workloads, DB services, templates, GitHub repositories, and assistant-driven actions.

The near-term product should focus on trustworthy deployment and operations, not on adding many new deployment types. Users should be able to start a deployment, understand what is happening, provide missing inputs, see results appear on the canvas, and diagnose failures without reading raw cluster state.

## 2. Contacts

| Role | Name | Comment |
| --- | --- | --- |
| Product owner | Project owner | Sets product scope, release order, and acceptance rules. |
| Engineering owner | sealai engineering team | Owns Next.js UI, Go API, deployment runner, database schema, and cluster integration. |
| Design owner | Product design owner | Owns Project Canvas, task timeline, side panes, and resource operation flows. |
| Primary user representative | Internal platform user | Validates whether deployment and operation flows are understandable. |
| Platform operator | Cluster/operator owner | Validates runtime, logs, metrics, auth, and production rollout safety. |

## 3. Background

`sealai` is a monorepo with a Next.js product UI, a Go backend API, shared UI and API packages, a component registry, and a WhoDB service. The current product already has a strong platform shape:

- Project Canvas shows AP, DB, AP Public Access, deployment placeholders, and related project surfaces.
- Deployment Task is the common model for Docker, database, template, GitHub, and assistant-driven deployments.
- GitHub deployments use an AI runner backed by a DevBox runtime and Codex Gateway.
- Docker, database, and template deployments use structured deterministic runners.
- Deployment Task Timeline owns user-facing progress, blocking inputs, result cards, failure details, and gateway snapshots.
- Project-level deployment projection streaming keeps the canvas updated while deployments run.
- The Go API handles AP, DB, K8s, logs, metrics, telemetry, and orchestration endpoints.

Why now:

- Recent work exposed that deployment reliability is now the main product risk. Examples include build runtime contract gaps, missing deployment inputs, stale failure text, incomplete template workload lifecycle support, DB lifecycle state getting stuck, and logs endpoint configuration issues.
- The architecture now has enough core pieces to make a coherent v1. The next step is not a new concept; it is making the existing deployment and operations loop consistent.
- Users need a platform they can trust during failure. A deployment that fails should explain where it failed, what input is missing, and what the user can do next.

## 4. Objective

The objective is to make Brain a reliable project operating platform for internal users who deploy and manage app stacks on Kubernetes-backed infrastructure.

It matters because users do not want to jump between chat, forms, cluster tools, logs, and raw Kubernetes resources to understand one deployment. A single task model and a single project canvas reduce confusion and make failures easier to recover from.

This aligns with the product strategy of making deployment and operations agent-friendly, observable, and repeatable. The assistant can help, but the task and project model must work even when the assistant is not open.

### Key Results

1. **Deployment completion:** Within one release, Docker, DB, template, and GitHub deployment paths create Deployment Tasks and reach a terminal state with a task-owned timeline in at least 95% of valid test runs.
2. **Failure clarity:** Within one release, 90% of failed Deployment Tasks show a clear failed step, failure summary, and structured failure details without requiring raw SSE or cluster shell access.
3. **Input recovery:** Within one release, 100% of Deployment Tasks blocked by missing required inputs can be resumed from the timeline pane without losing previous artifact output.
4. **Canvas handoff:** Within two releases, active deployments show stable placeholders on Project Canvas, and completed resources inherit or keep correct placement without visible jumps in normal cases.
5. **Lifecycle confidence:** Within two releases, AP and DB lifecycle smoke tests pass through create, inspect, restart, stop/start where supported, delete, and cleanup for the core supported resource types.
6. **Operator evidence:** Within one release, every shipped change to deployment, AP, DB, template, logs, or metrics includes a focused automated test or an agent-friendly manual test report.

## 5. Market Segment(s)

### Segment 1: Internal builders deploying app stacks

These users want to turn a Docker image, template, GitHub repo, or prompt into running project resources. They care about speed, clear progress, and easy recovery when required inputs are missing.

Constraints:

- They may not know Kubernetes object names.
- They expect deployment results to appear in the project they are working on.
- They need useful errors, not raw backend events.

### Segment 2: Platform operators supporting deployed projects

These users diagnose failed deployments, logs, metrics, resource health, and cluster integration issues. They care about structured evidence and safe operations.

Constraints:

- They need to distinguish app failure, deployment runner failure, gateway failure, API failure, and cluster failure.
- They need current DB/task/cluster truth, not stale UI state.
- They need redacted debug data for sensitive runtime inputs.

### Segment 3: Agent-assisted users

These users rely on chat or generated UI to create deployments and open project surfaces. They care about assistance, but the product must not hide task state inside the chat transcript.

Constraints:

- The assistant may create a task, but Deployment Task owns the lifecycle.
- Users must be able to re-enter task progress from Project Canvas.
- Tool output and generated deployment UI must be explainable and recoverable.

## 6. Value Proposition(s)

### Job 1: Deploy one project resource or stack

Users can deploy an app, database, template, or GitHub repo without choosing between separate product flows. Every path becomes a Deployment Task with a clear source, target, runner, progress timeline, and result.

Gain:

- One mental model for deployment.
- Clear status across fast direct runners and slower AI runners.
- Less confusion between chat output, runtime output, and applied resources.

Pain avoided:

- Losing the deployment state after refresh.
- Seeing a completed artifact but not knowing why final apply failed.
- Re-entering missing inputs from scratch.

### Job 2: Understand what is running in a project

Project Canvas gives users a visual map of AP, DB, public access, template-visible workloads, and deployment placeholders.

Gain:

- The project state is visible in one place.
- Users can open logs, terminals, settings, and task timelines from context.
- Temporary deployment state and real resources are visually connected but not confused.

Pain avoided:

- Jumping between resource lists and raw cluster tools.
- Canvas nodes jumping after deployment completes.
- Treating support objects as user-facing product resources.

### Job 3: Recover from deployment failure

Deployment Task Timeline explains the failed step, result resource status, missing inputs, gateway state, and structured failure details.

Gain:

- Faster triage.
- Safer redaction than full raw SSE storage.
- Better handoff between user, engineer, and operator.

Pain avoided:

- Debugging from incomplete screenshots.
- Reading raw gateway streams.
- Re-running long build steps when only configuration input is missing.

## 7. Solution

### 7.1 UX and user flows

#### Flow A: Create a project and deploy

1. User starts from project creation, template deployment, Docker deployment, DB deployment, GitHub deployment, or assistant action.
2. UI creates a Deployment Task with source, target, and runner.
3. The task resolves or creates the project target.
4. Project Canvas shows deployment placeholders and a Deployment Task Dock item.
5. User opens the task timeline to inspect progress.
6. If required inputs are missing, the timeline asks for them and resumes the task.
7. When resources are ready, result cards become healthy and Project Canvas hands off placeholders to real resources.

#### Flow B: Inspect and operate resources

1. User selects an AP, DB, or Public Access node on Project Canvas.
2. The product opens the correct side pane or main action surface.
3. User can view settings, logs, metrics, terminal, DB access, or lifecycle actions.
4. Operations update the resource and refresh the canvas without creating fake canvas state.

#### Flow C: Diagnose a failed deployment

1. User opens the task from the Deployment Task Dock or resource context.
2. Timeline shows failed step, recent events, result cards, blocking inputs, and failure summary.
3. Operator can inspect structured failure details and gateway state snapshot.
4. User can fix missing inputs or retry a safe task path when supported.

### 7.2 Key features

#### Feature 1: Unified Deployment Task model

All deployment entry points create Deployment Tasks. A task has source, target, runner, status, phase, artifacts, timeline, events, blocking inputs, failure details, and result URLs where available.

Supported source kinds for v1:

- Docker image.
- Database.
- Template.
- GitHub repository.
- Prompt or assistant-driven deployment where the AI runner is required.

Supported runner kinds for v1:

- Direct runner for structured Docker and database deployment.
- Template runner for structured template deployment.
- AI runner for GitHub and prompt deployment.

Out of scope for v1:

- Making every deployment go through AI.
- GitHub Actions as the main deployment runner.
- Full deployment history product separate from current task surfaces.

#### Feature 2: Task-owned Deployment Timeline

Each task owns its user-facing timeline. Runners define stable steps. The timeline can show:

- Queued, target resolution, prepare, plan, configure, generate artifacts, apply, verify, completed, failed, or cancelled states.
- Result resource cards for AP, DB, public access, and template-visible workloads.
- Blocking input forms.
- Failure summaries and structured failure details.
- Gateway state snapshots for AI runner tasks.

The timeline is not raw backend logs and not assistant chat.

#### Feature 3: Project Canvas deployment projection

Project Canvas shows deployment placeholders while tasks are running. It uses project-level deployment projection streaming and canvas placement rules.

The desired behavior:

- Placeholders appear quickly after task creation.
- Unknown deployment shape can start with one stable placeholder.
- Structured artifact evidence can refine placeholders into AP, DB, public access, or template workload slots.
- Real resources hand off from placeholders only by exact expected identity or explicit mapping.
- User-arranged placement wins over generated placement.

#### Feature 4: AP and DB operations

The product supports core AP and DB operations through project surfaces:

- AP: inspect, settings, image/version, environment, network, logs, metrics, terminal, restart, stop/start where supported, delete.
- DB: inspect, access, backups, restore, logs/metrics where supported, terminal/native client path, restart, stop/start where supported, delete.
- Public access: show AP-owned public routing state and open AP network settings.

The UI must not expose lifecycle actions for template-produced workloads unless the backend supports them.

#### Feature 5: Template deployment and template-visible resources

Template deployment applies deployment-scoped Brain labels and classifies product views by Kubernetes kind and relationships.

The product should show:

- Template deployment choice and parameters.
- Template-visible AP-like workloads.
- Template-visible DB-like workloads.
- Public access evidence from Ingress-to-Service-to-workload relationships.
- Support evidence only when it helps explain progress.

The product should not show every rendered Kubernetes object as a user-facing resource.

#### Feature 6: GitHub and assistant deployment

GitHub deployment uses the AI runner, a DevBox runtime, and the deploy skill output contract. The required output contract includes:

- Build result.
- Delivery manifest.
- Template YAML.

The final apply reads validated artifacts. Partial output progress can be shown, but it must not be treated as final success.

#### Feature 7: Observability and diagnostics

The product stores and shows structured debugging data:

- Append-only task events.
- Current timeline snapshot.
- Artifact summary.
- Gateway state snapshot, redacted.
- Failure details.
- Logs and metrics from the Go API.

The product should avoid saving full raw SSE unless a separate retention and privacy policy is approved.

#### Feature 8: Agent-friendly test evidence

The product should keep a durable test folder for AP, DB, and Template cases. Each case should include goal, steps, expected result, optional API checks, cleanup, and failure notes.

### 7.3 Technology

Current technology choices:

- Monorepo with `bun@1.3.5`.
- Next.js UI in `apps/ui`.
- Go API in `apps/api`.
- Shared UI package in `packages/ui`.
- Shared API package in `packages/api`.
- Drizzle/Postgres for app-owned deployment and layout data.
- Kubernetes-backed AP, DB, logs, metrics, terminal, and orchestration APIs.
- Project Canvas built on React Flow.
- Deployment runners in the UI app server side.
- DevBox plus Codex Gateway for AI runner execution.

Technical constraints:

- Deployment Task storage must remain deployment-owned, not chat-owned.
- Component registry must not own full product workflows.
- Crossplane compatibility is out of scope.
- Brain ownership labels must use deployment-scoped labels, not old resource-kind labels.
- Public access is AP-owned. AP Public Access Node is presentation-only.
- Canvas Layout should be the single placement store for resources and deployment projection placements.
- Database migration workflow is not yet production-grade if it only depends on `drizzle-kit push`.

### 7.4 Assumptions

1. Internal users prefer one coherent deployment model over separate source-specific flows.
2. Users will accept assistant help only if task state remains visible outside chat.
3. Structured debug fields are enough for most task failures, so full raw SSE storage is not needed for v1.
4. Template-produced workloads can be made understandable through labels, kind inspection, and relationship inspection.
5. The Go API remains the long-term boundary for cluster operations, while deployment task orchestration stays in the app server for now.
6. Current cluster and DevBox runtime contracts can be made stable enough for v1 without replacing the runner architecture.

## 8. Release

### First version: stabilize the deployment loop

Relative effort: one short release cycle.

Include:

- Keep all current deployment entry paths on Deployment Task.
- Make timeline input blocking and resume reliable.
- Keep failure details, artifact summary, and gateway snapshot visible enough for operators.
- Make GitHub output progress and final artifact validation clear.
- Keep Project Canvas deployment dock and timeline re-entry working.
- Keep AP, DB, and template agent-friendly test documents current.
- Fix UI action visibility when template-produced workloads do not support AP lifecycle APIs.

Do not include:

- New cloud providers.
- Full deployment history center.
- GitHub Actions deployment runner.
- Full raw SSE retention.
- Broad design system rewrite.

### Second version: make canvas handoff and operations trustworthy

Relative effort: one to two release cycles.

Include:

- Finish owner-based canvas placement and deployment projection handoff.
- Make Project Canvas stable during concurrent deployments.
- Expand AP and DB lifecycle tests.
- Improve logs and metrics surfaces with clear empty/error states.
- Make supported template-visible resource actions explicit.

### Later versions: scale and governance

Relative effort: after v1 is stable.

Include:

- Production-grade database migration workflow.
- Task retry policy and safe cancellation.
- Deployment history and audit views.
- More template categories and source providers.
- More operator controls for retention, redaction, and failure analysis.
- Team-level permissions if the product moves beyond internal trusted users.

## Open risks

- AI runner reliability depends on DevBox, gateway, skill output, image build, and final apply. Any one layer can fail.
- Template resource classification is harder than direct AP/DB because support objects and user-facing resources share one deployment scope.
- DB lifecycle behavior may differ by engine and provider state.
- Logs and metrics depend on correct cluster endpoint configuration.
- Without a production migration workflow, deploy-task schema changes remain risky for real production data.

## Acceptance checks

- A valid Docker image deployment creates a Deployment Task, shows progress, creates an AP, and shows the AP on Project Canvas.
- A valid DB deployment creates a Deployment Task, shows progress, creates a DB node, and supports the documented lifecycle actions.
- A valid template deployment creates a Deployment Task, asks for required parameters, applies template resources, and shows only user-facing resources.
- A valid GitHub deployment creates a Deployment Task, runs the AI runner, records output progress, validates artifacts, and applies resources or blocks for missing inputs.
- A missing required input blocks the timeline and can be submitted once without losing generated artifacts.
- A failed task shows the failed timeline step, failure summary, and structured failure details.
- Project Canvas does not replace user-arranged resource placement with generated deployment placement.
- Unsupported lifecycle actions are hidden or disabled for resources where the backend cannot execute them.
