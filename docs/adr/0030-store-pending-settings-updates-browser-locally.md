# Store Pending Settings Updates Browser-Locally

Pending Settings Updates are remembered in the user's browser local storage rather than in backend Project state or provider-local React state. A Pending Settings Update starts only after a Settings Submission write is accepted; rejected or still-in-flight submissions remain outside this storage boundary and are covered by ADR-0031. This preserves accepted-but-not-yet-reconciled target settings across settings entry points and browser refreshes without making them shared Project truth, while keeping room for a future backend settings operation model if cross-user visibility, audit, or durable failure handling becomes necessary.

## Considered Options

- Keep Pending Settings Updates only in provider-local React state: rejected because closing and reopening settings, or entering the same Settings Owner through a different Settings View, would lose the submitted target before the resource reconciles.
- Store Pending Settings Updates in backend Project or resource read-side state now: rejected because v1 does not yet need cross-user pending visibility, audit, or a durable settings operation lifecycle, and Project Resource Read Model explicitly avoids owning editable Settings backing.

## Consequences

Each Pending Settings Update records when it was submitted. If it remains unreconciled past the v1 attention window, the product should mark it attention-needed rather than silently deleting it or declaring the underlying resource failed; it is cleared only when observed resource state matches the submitted target, the user abandons it, or a newer submission replaces that Settings Domain's target.

Pending Settings Update storage is keyed by cluster fingerprint, Settings Owner kind, namespace, name, observed resource UID when available, and Settings Domain. The fingerprint must not store raw kubeconfig material. If a later observed resource UID does not match a stored UID for the same kind, namespace, and name, the product should ignore that stale pending target rather than applying it to a recreated resource.

The stored value is the complete canonical target for one Settings Domain, not the API patch used to submit it. API patches are write commands, while Pending Settings Updates must support display overlays and domain-level reconciliation against observed resource state.

When a user edits settings while a domain already has a Pending Settings Update, the new Settings Draft starts from the effective settings shown to the user: observed resource state plus that pending target overlay. A successful new submission replaces the previous pending target for each submitted Settings Domain.

Pending Settings Update reconciliation compares the pending target with the resource's observed desired configuration for that Settings Domain. It does not wait for runtime readiness, rollout completion, routing health, certificate readiness, DNS verification, or storage expansion health; those remain separate AP/DB status concerns.

For AP Environment, the pending target and reconciliation predicate use the canonical AP Environment Raw Source. Compiled runtime environment rows are write output, not the user-authored target; they are used only as a fallback projection when an existing resource has no observed Raw Source.

V1 Pending Settings Updates do not have a failed state. A write rejection remains a Settings Draft save failure and does not create a Pending Settings Update; after a write is accepted, an unreconciled pending target may become attention-needed but is not inferred failed from time alone.

Settings Submissions may let the user leave the settings surface while the write is still in flight. If the write is rejected, v1 provides only best-effort current-session recovery, such as a toast action back to the draft; failed submissions are not persisted across refreshes or sessions.

Rejected Settings Submission recovery restores the submitted draft for editing, not the original write command. A later resubmission must run the normal submit-time conflict detection and rebuild any API patch against the current observed backing.

Attention-needed pending targets offer Edit and Use Latest actions. Retry is intentionally not a v1 action because the stored target is not the original write command; resubmission should go through the normal Settings Draft submit flow, rebuilding any API patch against the current observed backing.

Each pending target also records the observed domain target it was submitted against. If the current observed desired configuration later becomes neither that submitted-against target nor the pending target itself, the product treats it as Observed Settings Divergence and asks the user to Keep Target or Use Latest rather than silently dropping the pending target or silently overlaying it over the changed resource.

A settings submission creates or replaces Pending Settings Updates only for Settings Domains that were dirty in that submitted draft. Full settings submissions must not create pending targets for unchanged domains.

Submit-time conflict detection is pending-aware. When a Settings Domain has an active pending target, the latest observed desired configuration is not conflicting merely because it still equals the observed target recorded at the pending submission time; that means the resource has not caught up yet. A third observed value triggers Observed Settings Divergence and requires the user to Keep Target or Use Latest.

Settings providers own the composition from observed resource state to pending target overlay to local Settings Draft assembly. Settings sections own only the local unsaved draft interaction for the effective settings they receive, so provider-defined views for the same Settings Owner and Settings Domain share one pending target.

Pending Settings Updates do not affect Canvas, node cards, runtime surfaces, deployment timelines, or other non-Settings Project surfaces in v1. They are presented only inside the corresponding Settings page or Settings View.

Settings pages present Pending Settings Update status immediately above the settings footer, keeping the message close to the Update/Discard actions without changing non-Settings surfaces.

When a Settings page includes multiple pending domains, it presents one status area above the footer with domain-level rows or groups rather than scattering pending messages through sections or collapsing all domains into one ambiguous status.

Pending status remains visible while the user edits a new Settings Draft from an existing pending target. The status explains that the draft starts from the target configuration rather than directly from the latest observed resource state.

Use Latest must not bypass unsaved-change protection. If the user has a dirty Settings Draft, choosing Use Latest first resolves the existing discard confirmation flow; only then does the product clear the relevant pending target and rebuild the effective settings from observed resource state.

When observed desired configuration matches a pending target for a Settings Domain, that pending entry is cleared and the status area disappears without a separate success banner.
