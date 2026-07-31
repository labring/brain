# Pin Pane-Level Actions in the Side Pane Footer; Hosts Place Compound Deployer Parts

Side Panes host surfaces that end in a commit gesture — a deploy form's
submit, a Settings Draft's Update/Discard row, a Deployment Task's lifecycle
actions — and those actions used to be the last item of the pane's scrolling
content: out of sight whenever the content outgrew the pane, and shaped
differently on every surface (full-width buttons in deploy forms,
right-aligned rows in settings and the timeline). The shared Side Pane now
has a third chrome region, the Side Pane Footer (CONTEXT.md): an optional
bottom region inside the inner chrome surface that stays visible while
content scrolls beneath it. It carries no separator line — the pane's visual
grammar layers by light rather than rules — and instead casts a soft shadow
onto the content, painted only while content still sits below the fold.

## Decision

Footer placement belongs to hosts, not to content components. Content mounts
into the region through a slot (`SidePaneFooter`) that works from any depth
of pane content: presence registers on mount (no contributor → no region, no
chrome), and the content itself travels through a portal into the region's
element, so contributor re-renders never touch pane-shell state — the
timeline's header-freeze design (stream ticks must not repaint the shell)
survives pinning. The lift shadow follows the same rule: scroll position is
written straight to the region's `data-lifted` attribute, never through
React state, so scroll ticks cannot repaint the shell either. Outside a Side Pane the slot renders its children in
place, so chrome-less hosts keep a working surface. Settings providers keep
delivering their draft footer as view-model data (the anti-loop chrome-model
design is untouched); the sections renderer wraps that node in the slot.

To let hosts decide placement, the Docker, Database, and Template deployers
are refactored to the compound composition already proven by the GitHub
deployer: a `Root` context provider owning states and actions, `Fields` for
the settings sections, a separately placeable `Submit`, and the assembled
default component kept backwards-compatible with its inline full-width
submit. The GitHub deployer is reused in chat surfaces that have no pane
chrome, so placement can never be baked into a form component — the same
rule now covers all deployers. Deploy panes and the project creation pane
place `Submit` in the footer (regular width, right-aligned, icon retained);
hosts without pane chrome keep the assembled inline form. The footer
container owns the right-aligned action-row layout; contributors supply
plain buttons, and the settings draft footer — already a complete row —
slots in whole.

## Considered Options

- Footer as a `SidePane` prop (host passes a ReactNode): rejected — the
  actions' state lives deep in pane content (deployer form state, settings
  drafts, the timeline subscription), so a prop would force lifting that
  state into hosts or threading ReactNodes up through host state, which the
  settings chrome model deliberately forbids (render-loop history).
- Footer baked into content components (each form renders its own pinned
  bar): rejected — content components are reused in hosts without pane
  chrome (GitHub deployer in chat, assembled forms elsewhere), and pinning
  is a property of the hosting chrome, not of the form.
- Direct-child extraction (SidePane scans children for footer elements):
  rejected as the sole mechanism — it cannot serve contributors that live
  deep in the tree (settings providers, creation steps), and two delivery
  paths would have to be kept equivalent forever.

## Consequences

- ADR 0048 is untouched: the footer lives inside the inner chrome surface,
  so the two-layer overlay animation (outer clip fade+nudge, inner
  full-width slide) carries it, and no `width`/`max-width` enters any
  transition-property (0048's regression tripwire).
- Portal delivery means the pinned content is absent from server-rendered
  markup and appears on the client after mount/hydration. Panes are
  client-interactive surfaces behind user actions, so no visible flash
  results; static-markup tests of chrome-less components keep passing
  through the in-place fallback.
- The footer region renders only while a contributor is mounted, so
  surfaces without pane-level actions (resource inspection, project index,
  skills workflow, the creation source picker, the GitHub step) show no
  empty chrome by construction.
- Keyboard order follows DOM order: the footer element sits after the
  scroll body inside the inner surface, so footer actions come after pane
  content in the tab sequence.
- The GitHub deployment pane keeps its inline per-repository Deploy rows —
  those are row-scoped, not pane-level, actions; the Blocking Input form
  likewise stays inside its Deployment Timeline Step.
