# Model All Deployments as Deployment Tasks

All deployment entry paths should create a Deployment Task. The task owns target resolution, runner execution, blocking inputs, artifacts, events, its Deployment Task Timeline, and final apply. GitHub and natural-language prompt deployments use an AI Runner, currently backed by a Deploy Devbox and Codex Gateway; Docker image, database, and template deployments use deterministic runners unless the user explicitly asks for AI assistance.

Deployment Task is the common lifecycle model, not a synonym for AI deployment. A task has a Deployment Source, Deployment Target, Deployment Runner, status, phase, and Deployment Artifacts. The Project relationship starts as the task's Deployment Target; resolving a new or existing Project happens inside the task's `resolve-target` phase, with resolved Project identity cached on the task for filtering and display.

Deployment Task is owned by the deployment domain. Assistant Chat is an adapter that can create, query, cancel, or explain a task, but ordinary deployment UI flows must not project task progress into the active chat transcript. The Chat status adapter reads the same deployment-owned task, safe events, and task-owned Timeline used by task surfaces; runner messages and arbitrary AI or Gateway transcript text are not part of that public progress contract. Task events are the canonical progress stream for task-oriented UI surfaces such as future task drawers, canvas status affordances, notifications, or assistant explanations requested by the user.

Runners produce or select Deployment Artifacts and the apply layer validates and applies those artifacts. Runner-specific work such as cloning a repository, interpreting a prompt, rendering Docker settings, or deploying a template should not bypass task events, blocking inputs, artifact summary, or final task status.

## Considered Options

- Keep GitHub as the only long-running deploy task and let Docker, database, and template deployments continue as synchronous UI flows: rejected because assistant-driven deployment would need source-specific tools and users would get inconsistent progress, retry, cancellation, and failure reporting.
- Route every deployment through the AI Runner: rejected because Docker image, database, and template deployments already have structured inputs and should remain deterministic by default.
- Create the Project before creating the task for new-Project deployments: rejected because partial success and failure would be split across the caller and the task rather than shown in one deployment timeline.
- Preserve compatibility with the current GitHub-only task schema: rejected while the product is still in development because a clean Deployment Source/Target/Runner model is easier to reason about than carrying repository fields as top-level task identity.

## Consequences

The deployment schema should model `source`, `target`, and `runner` as first-class task data instead of top-level repository fields. GitHub repository data belongs under a GitHub Deployment Source; Docker settings, database choices, template choices, and prompt text belong under their corresponding Deployment Source variants.

All product deployment surfaces and assistant deployment tools should create Deployment Tasks rather than directly applying resources. Direct and template runners may complete quickly, but they should still emit task events and artifact summaries so the deployment history is uniform. Deployment Task persistence should live in a deployment-owned schema rather than the Assistant Chat persistence schema; task records may include `createdFrom` metadata to distinguish UI, chat, API, or automation callers without changing lifecycle ownership.

Runner-message persistence may remain as internal compatibility storage, but readers must not treat it as the Deployment Task progress API. Timeline surfaces and Chat status reads use the task DTO, safe event projection, and Deployment Task Timeline. Exposing raw AI Runner transcript text would require a separately defined and tested redaction contract.

Deployment phases should be source-agnostic. The common sequence is queued, resolve target, prepare, plan, configure, generate artifacts, apply, verify, and completed, with status carrying whether the task is running, blocked, applying, completed, failed, or cancelled.

Blocking inputs are the task-level safety boundary. UI form submissions may proceed to apply by default, while assistant-inferred deployments and uncertain AI Runner decisions should block before apply unless the user clearly requested immediate execution.
