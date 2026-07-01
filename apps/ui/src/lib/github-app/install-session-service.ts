import "server-only";

import { and, eq, gt, lt } from "drizzle-orm";

import { getAssistantDb } from "@/lib/chat-persistence/db";
import {
  type GithubAppInstallSessionRow,
  githubAppInstallSessions,
} from "@/lib/chat-persistence/schema";
import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";

const INSTALL_SESSION_TTL_MS = 10 * 60 * 1000;

export interface GithubAppInstallSessionInput {
  namespace: string;
  returnPath: string | null;
  state: string;
  userId: string;
}

export async function createGithubAppInstallSession(
  input: GithubAppInstallSessionInput
): Promise<void> {
  const now = new Date();
  await getAssistantDb().transaction(async (tx) => {
    await tx
      .delete(githubAppInstallSessions)
      .where(lt(githubAppInstallSessions.expiresAt, now));
    await tx.insert(githubAppInstallSessions).values({
      expiresAt: new Date(now.getTime() + INSTALL_SESSION_TTL_MS),
      namespace: normalizeAssistantNamespace(input.namespace),
      returnPath: input.returnPath,
      state: input.state,
      userId: input.userId.trim(),
    });
  });
}

export function consumeGithubAppInstallSession(
  state: string
): Promise<GithubAppInstallSessionRow | null> {
  const trimmedState = state.trim();
  if (trimmedState === "") {
    return null;
  }
  const now = new Date();
  return getAssistantDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(githubAppInstallSessions)
      .where(
        and(
          eq(githubAppInstallSessions.state, trimmedState),
          gt(githubAppInstallSessions.expiresAt, now)
        )
      )
      .limit(1);
    await tx
      .delete(githubAppInstallSessions)
      .where(eq(githubAppInstallSessions.state, trimmedState));
    return row ?? null;
  });
}
