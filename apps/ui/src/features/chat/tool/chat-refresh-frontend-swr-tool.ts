import { tool } from "ai";
import type { ScopedMutator } from "swr";
import { z } from "zod";

import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";

/** AI tool id; handlers run only in `useChat` `onToolCall` — no backend `execute`. */
export const REFRESH_FRONTEND_SWR_TOOL_NAME =
  "refreshFrontendSwrCaches" as const;

export function buildRefreshFrontendSwrToolDescription(): string {
  return [
    "Revalidate **all** cached SWR (stale‑while‑revalidate) datasets in this browser tab after the assistant changed cluster state out‑of‑band (e.g. sandbox kubectl/API created, updated, or deleted projects, APs, DBs, etc.).",
    "Call whenever remote resources changed and the canvas, project explorer, compositions, logs, metrics, or other server‑backed widgets may be stale.",
    "Include `intention`: what cluster/API mutation warrants a UI refetch.",
    "This only triggers refetches; it does not apply patches itself.",
  ].join(" ");
}

const refreshFrontendSwrCachesInputSchema = z.object({
  intention: chatToolIntentionField,
});

export type RefreshFrontendSwrCachesInput = z.infer<
  typeof refreshFrontendSwrCachesInputSchema
>;

export type RefreshFrontendSwrCachesToolOutput =
  | {
      ok: true;
      /** Number of underlying SWR mutate results returned for matched keys */
      mutatedEntries: number;
    }
  | { ok: false; error: string };

/**
 * Revalidates every active SWR key in the cache scope (matcher always true).
 *
 * Prefer `useSWRConfig()` mutate so nesting under `SWRConfig` stays correct.
 */
export async function runRefreshFrontendSwrCachesTool(
  mutate: ScopedMutator,
  input: unknown = {}
): Promise<RefreshFrontendSwrCachesToolOutput> {
  const parsed = refreshFrontendSwrCachesInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  logChatToolIntention(REFRESH_FRONTEND_SWR_TOOL_NAME, parsed.data.intention);

  try {
    const batch = await mutate(
      () => true,
      undefined,
      // Refetch hooks with current fetchers — do not clear cache first
      { revalidate: true }
    );
    return {
      ok: true,
      mutatedEntries: Array.isArray(batch) ? batch.length : 0,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "SWR mutate failed";
    return { ok: false, error: msg };
  }
}

/** Declared on `POST /api/chat` without `execute`; handled in `onToolCall` on the client. */
export const refreshFrontendSwrCachesTool = tool({
  description: buildRefreshFrontendSwrToolDescription(),
  inputSchema: refreshFrontendSwrCachesInputSchema,
});
