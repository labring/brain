import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { getAssistantDb } from "./db";
import { assistantEntitlements } from "./schema";

const DEFAULT_FREE_CHAT_TURNS = 5;

export function freeChatTurnsLimit(): number {
  const raw = process.env.FREE_CHAT_TURNS?.trim();
  if (!raw) {
    return DEFAULT_FREE_CHAT_TURNS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_FREE_CHAT_TURNS;
  }
  return parsed;
}

export function isSystemOpenAiConfigured(): boolean {
  const key = process.env.SYSTEM_OPENAI_API_KEY?.trim();
  const base = process.env.SYSTEM_OPENAI_API_BASE_URL?.trim();
  return Boolean(key && base);
}

export interface FreeTierSnapshot {
  limit: number;
  remaining: number;
  used: number;
}

/** Read current free-turn usage for a namespace (does not consume). */
export async function getFreeTierSnapshot(
  namespaceKey: string
): Promise<FreeTierSnapshot> {
  const limit = freeChatTurnsLimit();
  if (limit === 0) {
    return { limit: 0, used: 0, remaining: 0 };
  }

  const [row] = await getAssistantDb()
    .select({
      freeTurnsUsed: assistantEntitlements.freeTurnsUsed,
    })
    .from(assistantEntitlements)
    .where(eq(assistantEntitlements.namespace, namespaceKey))
    .limit(1);

  const used = row?.freeTurnsUsed ?? 0;
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining };
}

/**
 * Atomically increments usage after a successful assistant turn.
 * Returns false when the limit was already reached (concurrent overage guard).
 */
export async function consumeFreeTurnIfAvailable(
  namespaceKey: string
): Promise<boolean> {
  const limit = freeChatTurnsLimit();
  if (limit === 0) {
    return false;
  }

  const db = getAssistantDb();
  await db
    .insert(assistantEntitlements)
    .values({ namespace: namespaceKey, freeTurnsUsed: 0 })
    .onConflictDoNothing();

  const updated = await db
    .update(assistantEntitlements)
    .set({
      freeTurnsUsed: sql`${assistantEntitlements.freeTurnsUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assistantEntitlements.namespace, namespaceKey),
        lt(assistantEntitlements.freeTurnsUsed, limit)
      )
    )
    .returning({ namespace: assistantEntitlements.namespace });

  return updated.length > 0;
}
