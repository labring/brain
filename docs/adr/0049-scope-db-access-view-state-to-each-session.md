# Scope DB Access View State to Each Session

Each DB Access Session creates a stable View State Registry alongside its Jotai store. The registry supplies fine-grained atoms keyed by DB Access Object View, and by column where required, for cross-component interaction state; query results stay in query hooks, component-private controls stay local, and frame-by-frame resize state stays in refs and the DOM. Open views retain their state while inactive, closing a view disposes its keyed state, and switching DB Services disposes the entire registry and store.

Session-level interaction state that is not owned by one DB Access Object View, such as Sidebar Tree expansion, loading, and child collections, uses session-scoped aggregate atoms with stable per-node selector atoms. Restore and persistence workflows may operate on the aggregate state, while rendered Tree Nodes subscribe only to their own node state; switching DB Services disposes both the selectors and their aggregate state with the session store.

## Considered Options

- Broad view Contexts or one broad view atom were rejected because unrelated consumers would continue to update together.
- A broad Sidebar Tree Context was rejected because changing one node would broadcast to every rendered Tree Node, even when aggregate state remains useful for restore and persistence.
- Module-level atom families were rejected because their global definition cache makes cleanup and isolation ambiguous when more than one DB Access provider exists.
- Persisting closed-view or per-service state was rejected to preserve the current lifecycle and avoid restoring presentation preferences against changed database objects.
