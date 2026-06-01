# Separate Project Route State from Project Surfaces and Project Canvas

Project route state is owned by a dedicated route-state module rather than by Project Surfaces or Project Canvas. Project Surfaces owns Side Pane, Main Action Surface, Session Drawer entries, and slot rules; Project Canvas owns canvas selection identity and node or edge derivation; Project route state owns URL persistence and coordinated route transitions across `selected`, `side`, `main`, and `drawer`.

This keeps canvas selection out of the Project Surface model while still allowing one user action to update canvas selection and surface slots consistently. The `/project` route and `/project/[uid]` route share Side Pane route state, while the workbench route state extends it with canvas selection, Main Action Surface, and Session Drawer state.

## Consequences

User-initiated route-state transitions use browser history entries so Back can return to a previous workbench state. System repairs such as invalid query cleanup and stale target cleanup replace the current history entry so broken or unsupported state does not remain in the history stack.
