# Submit Image Updates Inline from the AP Image Versions Surface

The AP Image Versions surface retains recent image versions for review and
rollback. We add an editable image input with an inline Update button so a
user can review the history and apply a new tag in the same place. That
puts a settings-changing control inside a surface whose other control —
Rollback — is an immediate Resource Action, so this record fixes where the
update's lifecycle lives and why the surface does not become a Settings
View.

## Decision

### The update is AP Settings work with an inline submit gesture

Submitting from the versions surface creates the same launch-domain
Pending Settings Update as an image edit made in AP Settings (browser-local
target per ADR-0030). The input shows the submitted target with an
applying indicator until the resource catches up, and an Observed Settings
Divergence resolves inline with the standard two-way choice — keep the
target (an ordinary resubmission) or adopt the observed configuration
(forget the local target; no request). Only the gesture is local to the
surface; the lifecycle never is. There is no second, direct image-update
path that bypasses pending or divergence.

### The surface stays a Resource Surface, not a narrow Settings View

Settings Views carry an invariant: everything inline in the view body
stages into the draft, and the footer commits. Rollback cannot honor it —
it is a Resource Action that replays a full desired-configuration snapshot
across domains through its own endpoint, and staging it into a
single-domain draft would contradict both the domain model and the
backend. Rather than break the staged-inline invariant inside a Settings
View, the surface remains a Resource Surface in which both controls are
action-shaped: the inline Update submits a settings change, and a row's
Rollback executes after its confirm dialog. The route-level settings leave
guard already covers switching between AP Settings and this surface, so a
dirty settings draft is resolved before the panes swap; the inline input
itself carries no leave guard — a single unconfirmed field is cheap to
retype.

### Update and rollback stay unlinked, and the inline editor is image-only

No control copies a version row's image into the input. Retyping an old
tag and submitting is an ordinary image-only update that keeps the rest of
the current configuration, while Rollback restores the whole snapshot —
the two must stay visibly different things, and the backend's spec-hash
dedup already keeps an identical re-apply from duplicating history. The
inline editor scopes to the image alone; pull policy and launch command
remain full-view work. When the inline draft is dirty, a Rollback confirm
additionally states that the unsubmitted image edit will be discarded, and
proceeding discards it.

## Considered Options

- A narrow Settings View with the standard draft footer: rejected. It
  would be the only settings view whose body hosts an immediate action, or
  it would exile Rollback into the review dialog — either bends the
  staged-inline invariant users learn everywhere else in settings.
- A direct image-update command outside the settings lifecycle: rejected.
  A second image path invisible to Pending Settings Updates and divergence
  produces conflicting truths with an in-flight settings edit.
- Read-only image display with navigation to AP Settings: rejected. The
  two surfaces share one side slot, so navigation swaps the panes and the
  review-then-update loop never closes.
- Staging rollback into the settings draft: rejected. Rollback replays a
  full snapshot across domains and is defined as a Resource Action; it has
  no coherent single-domain draft representation.
