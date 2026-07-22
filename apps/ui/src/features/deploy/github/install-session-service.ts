import "server-only";

import { and, eq, gt, lt, ne } from "drizzle-orm";

import {
  type AssistantPgTransaction,
  getAssistantDb,
} from "@/features/chat/persistence/db";
import {
  type GithubAppInstallSessionRow,
  githubAppInstallSessions,
} from "@/features/chat/persistence/schema";
import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";

import {
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  type GithubConnectionOwnerIdentity,
} from "./owner-identity";

const INSTALL_SESSION_TTL_MS = 10 * 60 * 1000;

export interface GithubAuthorizationSessionInput {
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
  state: string;
}

export async function createGithubAuthorizationSession(
  input: GithubAuthorizationSessionInput
): Promise<void> {
  const now = new Date();
  await getAssistantDb().transaction(async (tx) => {
    await tx
      .delete(githubAppInstallSessions)
      .where(lt(githubAppInstallSessions.expiresAt, now));
    await tx.insert(githubAppInstallSessions).values({
      expiresAt: new Date(now.getTime() + INSTALL_SESSION_TTL_MS),
      namespace: normalizeAssistantNamespace(input.owner.namespace),
      ownerIdentityVersion: input.owner.ownerIdentityVersion,
      returnPath: input.returnPath,
      state: input.state,
      workspaceActor: input.owner.workspaceActor.trim(),
    });
  });
}

function validGithubAuthorizationState(state: string, now: Date) {
  return and(
    eq(githubAppInstallSessions.state, state),
    gt(githubAppInstallSessions.expiresAt, now),
    eq(
      githubAppInstallSessions.ownerIdentityVersion,
      CURRENT_GITHUB_OWNER_IDENTITY_VERSION
    ),
    ne(githubAppInstallSessions.workspaceActor, "")
  );
}

export async function isGithubAuthorizationSessionValid(
  state: string
): Promise<boolean> {
  const trimmedState = state.trim();
  if (trimmedState === "") {
    return false;
  }
  const [row] = await getAssistantDb()
    .select({ state: githubAppInstallSessions.state })
    .from(githubAppInstallSessions)
    .where(validGithubAuthorizationState(trimmedState, new Date()))
    .limit(1);
  return row != null;
}

export function consumeGithubAuthorizationSession(
  state: string
): Promise<GithubAppInstallSessionRow | null> {
  return consumeAndCompleteGithubAuthorizationSession(state, (session) =>
    Promise.resolve(session)
  );
}

export function consumeAndCompleteGithubAuthorizationSession<T>(
  state: string,
  complete: (
    session: GithubAppInstallSessionRow,
    transaction: AssistantPgTransaction
  ) => Promise<T>
): Promise<T | null> {
  const trimmedState = state.trim();
  if (trimmedState === "") {
    return Promise.resolve(null);
  }
  const now = new Date();
  return getAssistantDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(githubAppInstallSessions)
      .where(validGithubAuthorizationState(trimmedState, now))
      .returning();
    return row == null ? null : complete(row, tx);
  });
}
