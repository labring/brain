# Anchor Log Windows as Live or Frozen

Resource Logs previously treated realtime as an independent auto-refresh flag next to a time range, which allowed incoherent states: polling a fixed historical range that can never yield new lines, and a "Last 1 hour" label describing a stale snapshot. We model the log window as exactly one of two states — a Live Log Window (relative span anchored to now, polls, follows the tail) or a Frozen Log Window (fixed wall-clock bounds, never polls) — with no independent realtime toggle. Pausing materializes the live window's bounds at that instant; a "relative but not live" state does not exist.

## Considered Options

- Independent auto-refresh toggle on any range (Grafana-style, the previous shape): rejected because it permits meaningless combinations by construction and forces the relative label to lie while paused.
- Keeping "relative but paused" legal, patched with a "data as of" indicator: rejected because the label then needs a second indicator to stay honest and the picker's two columns keep overlapping meanings; materializing bounds on pause keeps one source of truth.
- Live-but-not-following (scroll up while data keeps streaming into an append-only buffer, Datadog-style): deferred, not rejected. Done correctly it requires a streaming tail endpoint with monotonic cursors; on the current windowed REST polling with a per-fetch line limit, bursts create silent gaps that break the buffer's continuity promise, and entries lack stable identity for merge dedup. Revisit when a streaming tail endpoint lands — Live then gains a following sub-state and the bottom "Live" pill becomes an "N new lines" affordance.
- Half-open ranges ("from 11:15 until now, following"): out of scope; relative spans approximate the need.

## Consequences

- Resource Logs open in a Live Log Window (default span 1 hour) for both AP and DB panes. Entries render oldest-to-newest with the newest at the bottom, and Live keeps the list pinned to the tail.
- Selecting a relative span enters Live immediately with no Apply step; the absolute-range editor is the only Apply-gated surface and seeds from the materialized bounds of the currently displayed window.
- The range control never lies: Live reads "● Live · 1h"; Frozen always shows the actual bounds; the label "Custom" disappears from the product.
- Scrolling away from the bottom edge while Live is a pause gesture and freezes the window in place. Returning to Live is always explicit — a persistent bottom "Live" pill in any Frozen state, or the toolbar control. There is no auto-resume on reaching the bottom.
- The manual refresh button disappears from the logs toolbar: Live polls on its own, and a Frozen Log Window is fixed by definition (late-arriving lines are out of scope).
- Fetch truncation must be visible: when a window holds more lines than the fetch limit, the older end of the list must state that only the newest N lines are shown, in both states.
