# Orchestrate Project Surfaces Separately from Canvas Selection

Project surface open state is owned by a project-level surface orchestrator, Project Canvas owns canvas selection identity, and Project route state owns URL persistence plus coordinated route transitions across those concepts. This keeps Side Pane, Main Action Surface, and Session Drawer behavior available to assistant chat, toolbar actions, and future project features without coupling those entry points to canvas-specific pane query parameters.

Surface intents explicitly name their target slot instead of deriving placement from the interaction source. A canvas node click, node action button, assistant action, toolbar action, or keyboard shortcut may open any supported slot when that is the product behavior.

Main Action Surface intents may also state how they interact with Side Pane focus. The default is to focus the main-area surface over the Side Pane, while explicit intents may keep an inspection Side Pane visible when the workflow needs both.

The orchestrator uses three slot names: `side`, `main`, and `drawer`. `side` hosts Side Pane entries such as resource inspection, Project creation, and deployment panes. `main` hosts Main Action Surface entries such as DB Access and Resource Logs. `drawer` hosts Session Drawer entries such as AP Terminal and DB Terminal. Each slot is single-active, while Session Drawer may coexist with Side Pane or Main Action Surface.

Surface entries use stable resource targets rather than Kubernetes UID as the primary identity. AP and DB targets use the resource kind, namespace, and name; AP public address surfaces use the AP-bound surface key. Kubernetes UID may be carried as last-seen observed identity, but it is not the URL or surface ownership key.

Canvas selection is separate from surface targets. Resource-related surface intents normally synchronize canvas selection to the same resource so the canvas highlights the target, but closing or changing a surface does not require clearing selection, and Session Drawer remains pinned to its own target rather than following selection.

## Considered Options

- Keep AP, DB, public access, action, and terminal state inside Project Canvas: rejected because assistant chat and future project features also need to open project surfaces.
- Treat AP Terminal and DB Terminal as AP/DB pane modes: rejected because interactive sessions can coexist with inspection surfaces and should remain pinned to their session target rather than following canvas selection.
- Let each feature own its own surface query state: rejected because replacement, coexistence, and leave-guard behavior would become inconsistent across entry points.

## Consequences

The URL model separates canvas selection from project surface slots: surface entries belong to slots such as `side`, `main`, and `drawer`, while canvas selection records which AP, DB, AP Public Access Node, or edge is selected. The URL shape uses independent `selected`, `side`, `main`, and `drawer` query keys.

User-initiated route-state transitions use browser history entries so Back can return to a previous workbench state. System repairs such as invalid query cleanup and stale target cleanup replace the current history entry so broken or unsupported state does not remain in the history stack.
