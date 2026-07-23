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
const REFRESH_FRONTEND_SWR_ERROR_MAX_LENGTH = 500;
const REFRESH_FRONTEND_SWR_LEGACY_ENTRY_MAX = 1_000_000;

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

export const refreshFrontendSwrCachesOutputSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal("scheduled"),
    })
    .strict(),
  // Rolling deploy compatibility for tabs still running the previous bundle.
  z
    .object({
      mutatedEntries: z
        .number()
        .int()
        .nonnegative()
        .max(REFRESH_FRONTEND_SWR_LEGACY_ENTRY_MAX),
      ok: z.literal(true),
    })
    .strict()
    .transform(() => ({ ok: true as const, status: "scheduled" as const })),
  z
    .object({
      error: z.string().min(1).max(REFRESH_FRONTEND_SWR_ERROR_MAX_LENGTH),
      ok: z.literal(false),
    })
    .strict(),
]);

export type RefreshFrontendSwrCachesToolOutput = z.infer<
  typeof refreshFrontendSwrCachesOutputSchema
>;

function boundedRefreshFrontendSwrError(
  error: unknown,
  fallback: string
): string {
  let raw = fallback;
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === "string") {
    raw = error;
  }
  const normalized = raw.trim() || fallback;
  return normalized.slice(0, REFRESH_FRONTEND_SWR_ERROR_MAX_LENGTH);
}

/**
 * Schedules revalidation for every active SWR key in the cache scope.
 *
 * Prefer `useSWRConfig()` mutate so nesting under `SWRConfig` stays correct.
 */
export function runRefreshFrontendSwrCachesTool(
  mutate: ScopedMutator,
  input: unknown = {}
): RefreshFrontendSwrCachesToolOutput {
  const parsed = refreshFrontendSwrCachesInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: boundedRefreshFrontendSwrError(
        parsed.error.issues.map((issue) => issue.message).join("; "),
        "Invalid SWR refresh input."
      ),
    };
  }

  logChatToolIntention(REFRESH_FRONTEND_SWR_TOOL_NAME, parsed.data.intention);

  try {
    // A filter-only mutate revalidates matching keys without replacing data.
    const revalidation = mutate(() => true);
    Promise.resolve(revalidation).catch((error: unknown) => {
      console.error(
        "[refreshFrontendSwrCaches] revalidation failed:",
        boundedRefreshFrontendSwrError(error, "SWR revalidation failed.")
      );
    });
    return { ok: true, status: "scheduled" };
  } catch (error) {
    return {
      ok: false,
      error: boundedRefreshFrontendSwrError(error, "SWR mutate failed."),
    };
  }
}

/** Declared on `POST /api/chat` without `execute`; handled in `onToolCall` on the client. */
export const refreshFrontendSwrCachesTool = tool({
  description: buildRefreshFrontendSwrToolDescription(),
  inputSchema: refreshFrontendSwrCachesInputSchema,
  outputSchema: refreshFrontendSwrCachesOutputSchema,
});
