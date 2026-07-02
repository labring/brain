# Surface assistant billing as a free-allowance counter plus a one-time crossing notice

Each assistant turn runs under a Chat Billing Mode: `free` spends a platform-funded Free Chat Turn, `user` bills the caller's AI Proxy, and the `free`→`user` handoff is automatic. The Project Assistant Pane surfaces only the remaining Free Chat Turns while the mode is `free` — a small counter above the composer (e.g. `Free 3/5`) — plus a single toast at the moment billing crosses from `free` to `user`. It deliberately shows **nothing** during steady-state `user` billing, and **nothing at all** when no platform model is configured — a namespace that is `user` from its very first turn, whose untouched Free Chat Turns are never spendable as free.

We lead with Chat Billing Mode rather than the Free Chat Turns count because only the mode reliably says whether the caller is being charged: a `user` turn does not imply the free allowance is exhausted (a namespace with no platform model bills `user` while its count is still full), so rendering `Free 5/5` there would misreport paid usage as free. In Sealos every resource is metered against the user's account, so self-paid assistant usage is the ambient baseline — the *absence* of a free-allowance affordance is itself the honest signal that there is no free deal here, and a permanent "you're paying" badge would be redundant noise, no more warranted than a persistent "this database costs money" badge.

## Considered Options

- **A persistent self-paid indicator (e.g. `Paid · AI Proxy`) in steady-state `user`.** Rejected: paying is the normal state on a metered platform, so a permanent badge is noise; the automatic crossing is announced once and the ongoing fact needs no repeating.
- **A first-turn "you are now self-paying" notice for the no-platform-model case.** Rejected: that state never changes (the free count stays full because `user` turns never consume it), so the notice would re-fire on every reload unless suppressed by server-side per-namespace "already notified" state — a persistence cost we judged not worth it. The client instead fires the toast only on an observed `free`→`user` transition (previous mode explicitly `free`), which self-limits to once and never triggers cold-into-`user` sessions.

## Consequences

- **Accepted silent billing:** in a deployment with no platform model, the assistant bills the user's AI Proxy from the first turn with no in-product indication. This is the deliberate trade-off, mitigated by Sealos's account-wide metering being the user's existing mental model.
- The one-time crossing toast is the **sole** visibility moment for the handoff; because there is no persistent paying affordance afterward, that toast text must stand alone.
- All user-facing copy — the counter label and the crossing toast — is written in English, consistent with the rest of the Project Assistant Pane.
- The billing state is read client-side from the `X-Chat-*` response headers and seeded on load from the session bootstrap; no persistent billing-notice state is stored.
