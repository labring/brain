# Coalesce deployment stream updates into throttled React commits

## Context

Deployment progress reaches the UI over two SSE streams: a per-task **timeline**
stream (each event is a full snapshot) and a per-project **projection** stream
(`upsert`/`remove` deltas that feed the canvas). Both committed React state on
every event. The projection store sits at the top of the canvas module hook, so
each commit re-rendered the whole workbench subtree (canvas + side pane + dock)
and, on a topology change, rebuilt the O(N) resource graph; each timeline commit
re-rendered the pane. With many resources the event rate is high, so the canvas
and timeline "rapidly refreshed" and burned CPU even though per-leaf
memoization already limited DOM writes.

React 18/19 automatic batching does not help here: each SSE message is dispatched
as its own event-loop task, and batching only groups `setState` calls within one
task — so N messages across N tasks cause N renders.

## Decision

Coalesce on the **ingestion side** with a shared leading + trailing throttle
(`createThrottleScheduler`, 200 ms): buffer every event immediately — the latest
snapshot for the timeline, the folded projection list for the store — but hand
the result to React at most once per interval. The first event after a quiet
period commits immediately (leading edge); a burst collapses to one trailing
commit carrying the final state. `isLoading`/`error`, the initial fetch, and
manual refresh stay immediate; the pending timer is cancelled on teardown.

## Considered options

- **requestAnimationFrame coalescing** — rejected: its ceiling tracks the display
  refresh rate (~60 Hz, higher on 120/144 Hz), and the bottleneck is per-render
  CPU (large subtree + graph rebuild), not paint. A fixed interval lets us set
  the commit rate *below* the refresh rate.
- **`useDeferredValue` / `useTransition`** — complementary, not a substitute:
  they re-prioritise the heavy render but do not reduce the number of updates.
  Left as a later lever if a single rebuild is still too costly.
- **Narrowing subscriptions (`useSyncExternalStore` + per-leaf selectors)** — the
  deeper fix for render *breadth* (canvas/pane/dock re-rendering together);
  deferred as higher-risk on an untested store. Throttling cuts *frequency*
  first, and the two compose.

## Consequences

- Live updates can lag by up to 200 ms during a burst — imperceptible for this
  surface, and a terminal state still lands within one interval.
- The canvas topology-changed callback now diffs last-published vs. next-published
  rather than every event, so intra-window flaps no longer trigger spurious
  workload reconciliations.
