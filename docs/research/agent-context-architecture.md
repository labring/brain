# Project Assistant Context Architecture Research

> Date: 2026-09-02  
> Scope: Context selection, project-wide discovery, on-demand content retrieval,
> conversation memory, execution boundaries, and deployment provenance.  
> Sources: official specifications, first-party documentation, and upstream source
> repositories only.

## Executive conclusion

The proposed Brain architecture matches the strongest recurring design across MCP,
Cursor, VS Code, Continue, Aider, Claude Code, Letta, LangGraph, OpenAI Agents SDK,
OpenHands, and Flux:

```text
stable project identity
  -> message-scoped selected context reference
  -> lightweight project resource discovery
  -> just-in-time content and live-state reads
  -> structured, separately authorized domain tools
```

The important refinement is to distinguish two kinds of Template knowledge:

- A Template README is mutable, explanatory, untrusted content. Read the latest
  available version on demand and report its retrieval metadata. It must not define
  executable configuration.
- A Template Runtime Contract and Deployment Source are operational facts. Bind them
  to the deployed revision or content digest so the Assistant can manage the actual
  deployed system rather than whatever the upstream README says today.

Brain should therefore extend its existing message-pinned Selected Resource Context,
not replace deployment links with an automatic Chat message protocol.

## Evidence from other systems

### Model Context Protocol: resources are not prompts or tools

MCP defines three different primitives: user-controlled prompts,
application-controlled resources, and model-controlled tools. Resources are
discoverable by stable URI, can be explicitly selected in UI, and are read separately
through `resources/read`. Resource metadata includes title, MIME type, size,
last-modified hints, audience, and priority. The protocol deliberately leaves
selection and inclusion policy to the host application.

This supports a Brain split between:

- `SelectedContextReference`: the user's message-level selection;
- `ProjectContextIndex`: application-controlled resource discovery;
- `readProjectContent`: retrieval of the selected or agent-chosen resource;
- domain tools: mutation and deployment operations.

Sources:

- [MCP server overview: prompts, resources, and tools](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [MCP Resources specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/server/resources.mdx)
- [MCP security and user-control principles](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/index.mdx)
- [MCP TypeScript SDK resource guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)

### Cursor and VS Code: explicit references plus automatic discovery

Cursor exposes files, folders, code, documentation, git state, past chats, and web
content as explicit context selections. For a large file it chunks and reranks the
content; for a folder it normally supplies a path and overview rather than eagerly
including every file. Its guidance warns that broad context can add cost and dilute
signal.

VS Code uses both implicit context (the active file or selection) and explicit
message-level context references. It also lets an agent discover more context with
tools. External URL access requires confirmation, and the UI exposes context and tool
activity for diagnosis.

Brain already implements the equivalent of the active selection by pinning
`data-selectedResource` to a user message. The missing feature is a typed, visible
context reference and a project-scoped resource discovery layer.

Sources:

- [Cursor context references](https://docs.cursor.com/context/%40-symbols/overview)
- [Cursor files and folders](https://docs.cursor.com/context/%40-symbols/%40-files-and-folders)
- [Cursor working with context](https://docs.cursor.com/en/guides/working-with-context)
- [VS Code: add context to chat](https://code.visualstudio.com/docs/chat/copilot-chat-context)
- [VS Code: use tools with agents](https://code.visualstudio.com/docs/agents/run/tools)

### Continue and Aider: compact indexes, details on demand

Continue's current guidance has moved away from broad `@Codebase` and `@Docs`
providers toward built-in exploration/search tools and MCP-backed documentation.
Its context provider model still demonstrates typed, user-selectable context items
such as files, symbols, diffs, and repository maps.

Aider's repository map is a concise whole-repository index. It ranks relevant
symbols to fit a token budget (documented as normally around 1,000 tokens), then
loads full files only when needed. Aider explicitly warns that too much irrelevant
context can confuse the model.

This supports deriving a small Project Context Index and reading README, Runtime
Contract, Timeline, logs, and resource state only for the current question.

Sources:

- [Continue codebase and documentation awareness](https://docs.continue.dev/guides/codebase-documentation-awareness)
- [Continue context providers](https://docs.continue.dev/customize/deep-dives/custom-providers)
- [Aider repository map](https://github.com/Aider-AI/aider/blob/main/aider/website/docs/repomap.md)
- [Aider repo-map implementation](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py)

### Anthropic, Letta, OpenHands, and LangGraph: keep durable state small

Anthropic's context-engineering guidance treats context as a finite attention budget.
It recommends keeping lightweight identifiers and loading data just in time with
tools instead of preprocessing all possibly relevant data into every inference.
Claude Code is cited as a hybrid: durable project instructions are loaded up front,
while files are explored through glob, grep, and reads.

Letta separates limited in-context memory blocks from external memory and uses links
as discovery paths. OpenHands condenses immutable conversation events into a smaller
view when the context window grows. LangGraph separates thread-scoped conversation
state from application-defined stores and warns that stale or excessive history can
distract models.

These systems support keeping Brain's Project identity stable, pinning selected
references to messages, and keeping project knowledge outside the transcript until
it is needed.

Sources:

- [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Letta memory architecture](https://github.com/letta-ai/skills/blob/main/letta/letta-api-client/memory-architecture.md)
- [Letta memory block implementation](https://github.com/letta-ai/letta/blob/main/letta/schemas/memory.py)
- [OpenHands condenser interface](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/context/condenser/base.py)
- [LangGraph memory overview](https://langchain-ai.github.io/langgraph/how-tos/memory/manage-conversation-history/)

### OpenAI Agents SDK: application context is separate from session history

The OpenAI Agents SDK separates typed run context (application dependencies and
runtime state) from sessions (conversation history). Sessions support filtering,
trimming, deduplication, and compaction before model input. Tool execution can have
explicit approval requirements.

Brain should similarly avoid persisting a dynamic Project Context Index as Chat
history. Conversation messages persist what the user selected; current project facts
are obtained from the deployment and resource domains at run time.

Sources:

- [OpenAI Agents SDK sessions](https://openai.github.io/openai-agents-js/guides/sessions/)
- [OpenAI Agents SDK tools and approvals](https://openai.github.io/openai-agents-js/guides/tools/)
- [OpenAI Agents SDK RunContext](https://openai.github.io/openai-agents-js/openai/agents/classes/runcontext/)

### Flux and GitHub: executable provenance needs immutable revisions

Flux resolves a moving Git branch into an Artifact with both a revision and a digest.
Consumers use the content-addressed artifact rather than treating the branch name as
an immutable version. GitHub likewise distinguishes branch links from permanent
commit links.

The Appsmith example README URL contains the moving branch `release`:

```text
https://raw.githubusercontent.com/appsmithorg/appsmith/release/README.md
```

It is suitable as a live explanatory resource. It is not sufficient provenance for
the Template version that created a Project. A Template Runtime Contract or
executable Template Source must use a revision/digest independently of the README.

Sources:

- [Flux GitRepository Artifact revision and digest](https://github.com/fluxcd/source-controller/blob/main/docs/spec/v1/gitrepositories.md)
- [Flux source-controller capabilities](https://github.com/fluxcd/source-controller)
- [GitHub permanent links to files](https://docs.github.com/en/repositories/working-with-files/using-files)

## Recommended Brain model

### Stable conversation context

Keep only Project identity in stable model instructions:

```ts
interface AssistantProjectContext {
  projectId: string;
  projectName: string;
  namespace: string;
}
```

Workspace Actor authorization is not prompt context. Revalidate it server-side for
each read and write.

### Message-scoped selected context

Use a typed reference, not copied content:

```ts
type SelectedContextReference =
  | ProjectResourceReference
  | DeploymentTaskReference
  | TemplateReference
  | ProjectContentReference;
```

Pin the reference and a display snapshot to the user message. Render it in the
transcript. Resolve it server-side; never trust client-provided content or ownership.

### Derived project index

Expose a read-only, current projection:

```ts
interface ProjectContextIndex {
  project: ProjectReference;
  resources: ProjectResourceReference[];
  activeTasks: DeploymentTaskReference[];
  activeContents: ProjectContentReference[];
  deploymentHistory: DeploymentTaskReference[];
}
```

Do not persist this index as a second truth source. Build it from Projects,
Deployment Tasks, Artifacts, result resource references, and current resource state.

### Content resolver

Expose content through a bounded, read-only contract:

```ts
interface ResolvedProjectContent {
  reference: ProjectContentReference;
  title: string;
  mimeType: string;
  content: string;
  digest: string;
  retrievedAt: string;
  resolvedRevision?: string;
  truncated: boolean;
  trust: "untrusted-content" | "deployment-contract";
}
```

The resolver must verify the current Workspace Actor, namespace, Project, and
provenance relationship. It must enforce fetch allowlists, redirect limits, response
size and time limits, safe MIME types, and secret redaction.

### Template README versus Runtime Contract

Use separate semantics:

| Content | Freshness | Authority | Use |
| --- | --- | --- | --- |
| README | Fetch on demand; may follow a moving branch | Advisory and untrusted | Explain the application and general usage |
| Template metadata/input schema | Resolve from Brain's trusted Template Provider | Structured but may evolve | Discover inputs and describe catalog state |
| Runtime Contract | Bind to deployed revision/digest | Operationally authoritative | Configure, diagnose, repair, and verify |
| Deployment Source/Artifact | Immutable task record and digest | Execution authority | Reproduce and audit what was deployed |

If historical README fidelity becomes a product requirement, add a content-addressed
snapshot cache. It is not necessary merely to let the Assistant read existing
Template README links.

## Rejected architecture

Do not encode Template, GitHub, and topic data into a URL `intent`, synthesize a user
message, and automatically invoke Chat. That design merges resource selection,
content retrieval, user instruction, and domain execution. It also duplicates the
existing `/deploy` entry and consumes a model turn without a user message.

The existing one-click deployment paths remain separate:

```text
Desktop /oauth -> Brain /deploy -> Deployment Task
```

The Assistant path is:

```text
Project identity + selected context reference
  -> discover/read project content
  -> understand explicit user request
  -> call an authorized domain tool when needed
```

## Implementation consequences and acceptance checks

1. Preserve current `data-selectedResource` reads; introduce a generic typed context
   part through a compatibility migration rather than rewriting old messages.
2. Render the context reference on every user message and retain its historical
   display snapshot if the target is renamed or deleted.
3. Add project-scoped list/read tools; do not inject all README or resource state into
   every model call.
4. Add Template README resolution with a strict outbound-fetch policy and content
   metadata. Treat its text as data, never instructions.
5. Add versioned Template Runtime Contract and Deployment Source provenance before
   allowing the Assistant to perform version-sensitive management.
6. Derive resource-to-source relationships from Deployment Artifacts and stable
   labels, never fuzzy names.
7. Reauthorize every content read and domain mutation. Selecting context never grants
   permission and never triggers a model call or write.
8. Test cross-project reference spoofing, stale and deleted references, mutable README
   changes, redirect and size abuse, prompt injection, secret exclusion, historical
   message semantics, and unchanged one-click deployment behavior.

