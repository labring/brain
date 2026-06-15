# Detect Settings Draft Conflicts at Submit Time

Settings drafts should remain uninterrupted while the user edits. On submit, Brain compares the draft's saved-resource base against the latest saved backing by settings domain, auto-merges non-conflicting changes onto the latest backing, and asks the user to reload or keep editing only when the edited domain changed externally.

## Considered Options

- Show a live "backing resource changed" warning while editing: rejected because the rendered settings model includes derived presentation facts such as DB reference sources, defaults, status, and routing context, so editing-time detection can mistake presentation changes for saved-resource conflicts.
- Treat any saved-resource revision change as a blocking conflict: rejected because unrelated changes should not interrupt a draft that can be safely applied to the latest backing.
- Offer overwrite as the first conflict action: rejected for v1 because environment and network settings can contain unrelated user work, and overwriting without a domain diff or merge UI can discard external changes.

## Consequences

Settings conflict detection is a submit-time responsibility, not a persistent editing banner. Providers should track the saved backing revision that a draft was based on separately from the derived presentation model used to render the form. A conflict prompt should say that the AP configuration changed since editing started and offer "Keep editing" and "Reload latest"; "Overwrite" can be added later only with clearer domain-level diff or merge behavior.
