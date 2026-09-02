import "server-only";

import { and, eq, gt, lt, sql } from "drizzle-orm";

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
 * Atomically reserves one free turn BEFORE model execution. The `lt` guard
 * makes concurrent reservations race on the counter itself, so only one of
 * two requests seeing `remaining = 1` can run its turn free — the loser must
 * re-evaluate its posture before touching the platform model.
 * Returns false when the limit was already reached.
 */
export async function reserveFreeTurnIfAvailable(
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

/**
 * Returns a reserved free turn after an unsuccessful turn (stream error,
 * abort, lost lease, or a preflight failure after reservation). The `gt`
 * guard keeps the counter monotonic under a spurious double release. A crash
 * between reservation and release leaks one turn — bounded, and it errs
 * toward the platform, never toward overspending the lifetime cap.
 */
export async function releaseReservedFreeTurn(
  namespaceKey: string
): Promise<void> {
  await getAssistantDb()
    .update(assistantEntitlements)
    .set({
      freeTurnsUsed: sql`${assistantEntitlements.freeTurnsUsed} - 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assistantEntitlements.namespace, namespaceKey),
        gt(assistantEntitlements.freeTurnsUsed, 0)
      )
    );
}
