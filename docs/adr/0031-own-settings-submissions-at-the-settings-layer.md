# Own Settings Submissions at the Settings Layer

Settings Submissions are owned by the shared settings layer rather than AP or DB Settings Sections. Sections construct owner-specific drafts, domain targets, and write commands, while the settings submission boundary owns submission identity, in-flight lifecycle, accepted-to-pending transition, and best-effort rejected-write recovery so AP and DB do not duplicate detached submission orchestration.

V1 does not allow concurrent Settings Submissions for the same Settings Owner and Settings Domain. A submitting domain should present a submitting state rather than allowing another submission that can race, reorder accepted pending targets, or let an older rejection overwrite a newer draft.

When a settings submission covers multiple dirty Settings Domains, the settings layer treats it as blocked if any submitted domain already has an in-flight submission for the same Settings Owner. V1 blocks the whole submission rather than partially submitting only the non-overlapping domains.

When a Settings Submission is accepted, the settings layer creates Pending Settings Updates only for the submitted dirty Settings Domains. It stores each domain's canonical target rather than the whole draft snapshot or the write command.

If the user reopens the same Settings Owner and Settings Domain while a submission is in flight, the settings surface should render the submitted target as the effective settings with a submitting status. After the write is accepted, the same target becomes a Pending Settings Update and is shown as applying until observed desired configuration catches up.

Settings Submissions are shared across Settings Views by Settings Owner and Settings Domain. A narrow Settings View and the full settings surface must see the same in-flight submitted target and domain-level submitting lock.

The write response is the acceptance boundary for a Settings Submission. If observed desired configuration happens to match the submitted target before the write response resolves, the submission still remains submitting until the write is accepted or rejected; accepted submissions may then reconcile immediately if the observed target already matches.

Rejected submission recovery must not silently overwrite a newer dirty Settings Draft. If the user already has dirty edits for the same Settings Owner and Settings Domain, recovery should go through the existing unsaved-change resolution flow before restoring the failed submission's draft.

Rejected submission recovery should be presented as returning to the draft, not as retrying. User-facing actions should use language such as "Back to draft" because the product restores editable settings and rebuilds a write command only after the user submits again.

The shared submission boundary owns lifecycle state and events rather than rendering toast UI directly. Settings hosts or providers choose the user-facing notification copy and actions, while recovery actions call back into the submission boundary by submission identity.

Settings Submission identity uses the same owner boundary as Pending Settings Updates: cluster fingerprint, Settings Owner kind, namespace, name, observed resource UID when available, and Settings Domain. The submission stage must not use weaker kind/namespace/name keys that can cross clusters or recreated resources.

When observed resource UID is unavailable, Settings Submissions may still be keyed by cluster fingerprint, Settings Owner kind, namespace, name, and Settings Domain. If a later observed UID does not match a submission or pending entry recorded with a UID, the settings layer should ignore that stale entry for the recreated resource.
