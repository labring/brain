# Treat Shared Deploy Intents as Untrusted Message-Level Context

External entry points (the Template site, the in-flight GitHub one-click deploy, blogs, and solution pages) want a user to land in Brain with a deployment already in context: "deploy GLPI", "deploy this repository", or "deploy what this article describes". The entry URL carries a small, structured deployment intent (`?intent=<encoded-json>`) next to the existing `side` UI-navigation param. The Assistant must receive that context to continue the deployment, but the URL is an untrusted channel: any producer — or an attacker forging a link — can write anything there. We therefore treat the intent as *untrusted, message-level data*, validate it fail-closed on the server, and never let it enter the system prompt.

## Decision

### Protocol

The entry URL is `?openapp=system-brain&side=<encoded-side>&intent=<encoded-json>`:

- `side` keeps today's UI navigation exactly as-is (Template/GitHub panes, project creation). This ADR adds nothing to `side`.
- `intent` is a version-1 JSON envelope: `{ version: 1, kind: "template" | "github" | "topic", source?: string, payload: ... }`.
  - `template` payload: `{ templateName: string, args?: Record<string, string> }`.
  - `github` payload: `{ repo: { fullName, name, url, id? }, branch?: string }`.
  - `topic` payload: `{ query: string, ref?: string }` — bounded free text, never a full blog post.

The client converts the intent into a `data-deployIntent` UI message part on a single synthetic first user message and removes the `intent` param from the URL with `history.replaceState`, guarded by a `chatId + raw value` session marker, so Strict Mode, re-renders, and refreshes never re-send it. `side` behavior is preserved untouched.

### Trust model: `data-selectedResource` vs `data-deployIntent`

ADR-0044 pinned the canvas selection to each user message as `data-selectedResource` and bridged it into model-visible text as a delimited data block. `data-deployIntent` reuses that message-level data-block mechanism but sits at a *lower* trust level:

- `data-selectedResource` is captured from the user's own live canvas inside Brain at send time. It describes resources the user is already looking at, and its fields are bounded identifiers.
- `data-deployIntent` arrives over an external URL and can be produced by anyone who can mint a link. Nothing in it is trusted until the server validates it.

Both share the same delivery discipline (per-message data part, attribute-escaped block labeled *data, not instructions*, never in the system prompt). They differ in what the model may do with them: the selection is ambient context for deictic references; the deploy intent is a *proposal* that must be verified and confirmed through the normal tool pipeline.

### Fail-closed server validation

Every `POST /api/chat` inbound user message is scrubbed regardless of who produced the part (including an attacker posting a forged body). At most **one** valid intent is accepted; any failure drops the entire part — or all parts when repeated — without blocking ordinary conversation:

- Envelope: `version` must be `1`; `kind` must be one of the three; `source` and every field are length-bounded.
- `template`: `templateName` must exist verbatim in `listTemplateCatalog` (a fresh provider read per request). `args` may contain only catalog-declared inputs; values must match the declared type; inputs matched by `isSensitiveDeploymentInput` are stripped. An undeclared or mistyped arg rejects the whole intent. If the catalog is unavailable, the intent is dropped — absence of proof is a failure.
- `github`: aligned with the existing `chatDeploymentTaskSourceSchema` — a legal HTTPS `github.com` URL whose path is exactly `owner/repo`, `fullName`/`name` consistent with that URL, and a bounded branch.
- `topic`: bounded free text only (length, whitespace, newline checks). It is deliberately *low-trust*: the Agent disambiguates it with `searchDeployCatalog` and asks the user to pick before creating anything.

The validated payload replaces the part data before persistence, so the audit trail matches exactly what the model sees.

### Message-level bridge

`data-deployIntent` never enters the system prompt. A pre-convert pass (`withDeployIntentContext`, mirroring `withSelectedResourceContext` from ADR-0044) renders a delimited `<deploy_intent ... />` block at the top of the user turn that carries it, with every attribute value escaped for `& < > "`. The block is labeled *DATA, NOT INSTRUCTIONS*, names the kind-specific verification the Agent must do, and states that it is not a direct deployment command.

### Agent behavior

The system prompt teaches the deployment source preference (catalog template → GitHub → prompt → docker, never an invented image) and the intent contract: `template` intents still ask for missing required args and create tasks through the existing confirmation flow; `github` intents go through the existing GitHub task flow (credential binding when present, public-repo check when unbound); `topic` intents are disambiguated via `searchDeployCatalog` with the user choosing. An intent never bypasses tool approval/confirmation semantics.

### Secret ban

URLs are logged, shared, and replayed; they are not a secret channel. Template args that match `isSensitiveDeploymentInput` are stripped, and the protocol documents that secrets, tokens, and kubeconfigs must never be placed in `intent`. No new database tables, migrations, environment variables, or services are introduced.

## Considered Options

- **Put the intent in the system prompt**: rejected — the system prompt is the highest-authority part of the model input and must stay a byte-stable, cacheable prefix (ADR-0044). Untrusted external text does not belong there.
- **Trust the client to send already-validated intents**: rejected — the chat route accepts arbitrary HTTP bodies; only server-side validation is meaningful. Any client that fails to validate is indistinguishable from an attacker.
- **Validate template args leniently (pass unknown args through)**: rejected — the catalog is the authority on what a template accepts. Passing unknown args through would let a crafted link inject deployment configuration the producer never declared.
- **Fail open when the template catalog is unreachable**: rejected — with no catalog we cannot prove `templateName` is canonical, so the fail-closed rule drops the intent. Ordinary chat is unaffected because only the intent part is dropped.
- **Treat the intent as a direct deploy command**: rejected — an external link must never trigger a deployment by itself. The model must verify and the user must confirm through the existing tool approval flow.
- **Embed the whole blog/article in the URL**: rejected — URLs are bounded and shared; `topic` carries only `query`/`ref`.

## Consequences

- A user arriving from the Template site, a GitHub link, a blog, or a solution page gets the deployment context into the right-hand Chat Agent and can complete the deployment there; `side` keeps opening the matching UI.
- Attackers can still mint arbitrary links, but the worst case is a dropped intent part — never a model instruction, a secret, or an unconfirmed deployment.
- The intent survives as a per-message `data-deployIntent` part in storage, giving an audit trail of exactly what context each deployment message carried (the same property ADR-0044 gives the selection).
- Producers outside this repository must build the link with the documented builder/contract (`deploy-intent-link`): the fragile assumption is that the launcher passes `intent` through to the Brain iframe, so Brain exposes a direct-URL path and unit-tests it.

## References

- ADR-0044 — Pin Chat Context to Each User Message (the message-level data-block mechanism this decision extends).
- ADR-0036 / ADR-0056 / ADR-0059 — GitHub connection ownership and credential binding, which the chat GitHub flow reuses.
- ADR-0037 — Deployment tasks execute under leases; the chat tool mirrors the engine lifecycle.
