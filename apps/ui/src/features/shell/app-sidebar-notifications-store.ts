import { atom } from "jotai";

/**
 * Optimistic read receipts layered over the items' own `unread` flags:
 * clicking a row or "mark all as read" lands here first, and the server
 * receipt (and, best-effort, the CR label) follows. Keyed by the
 * source-prefixed notification id, so a revived platform message (new
 * timestamp, new id) is never covered by a stale receipt.
 */
export const notificationReadIdsAtom = atom<ReadonlySet<string>>(
  new Set<string>()
);
