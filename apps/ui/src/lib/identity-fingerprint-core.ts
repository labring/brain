import { and, eq, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AssistantPgDatabase } from "@/features/chat/persistence/db";
import {
  assistantChats,
  githubOauthConnections,
  identityFingerprints,
} from "@/features/chat/persistence/schema";
import { CURRENT_GITHUB_OWNER_IDENTITY_VERSION } from "@/features/deploy/github/owner-identity";

/**
 * Identity Fingerprints (ADR-0059): the authorization layer's region-local
 * observation history of `crName → userUid` bindings. Every verified
 * personal-resource request consults and maintains the fingerprint; a
 * newer-minted contradiction is an account-merge signal that re-keys the
 * tombstone uid's personal resources to the surviving uid in the same
 * transaction, and an older-minted contradiction marks a superseded token
 * that the authorization layer refuses.
 */

/** The token-proven binding a verified request observes. */
export interface ObservedIdentityBinding {
  crName: string;
  /** The token's minting time (JWT `iat`, epoch seconds). */
  mintedAt: number;
  userUid: string;
}

export type IdentityFingerprintObservation =
  | { outcome: "first_observation" | "match" | "merge" }
  | {
      /** The newer-minted binding this token contradicts. */
      observedMintedAt: number;
      observedUserUid: string;
      outcome: "superseded";
    };

export type ObserveIdentityFingerprint = (
  binding: ObservedIdentityBinding
) => Promise<IdentityFingerprintObservation>;

function requireObservableBinding(
  binding: ObservedIdentityBinding
): ObservedIdentityBinding {
  const crName = binding.crName.trim();
  const userUid = binding.userUid.trim();
  if (
    crName === "" ||
    userUid === "" ||
    !Number.isFinite(binding.mintedAt) ||
    !Number.isInteger(binding.mintedAt) ||
    binding.mintedAt < 0
  ) {
    throw new Error("A verified identity binding observation is required.");
  }
  return { crName, mintedAt: binding.mintedAt, userUid };
}

export function createIdentityFingerprintStore(
  getDb: () => AssistantPgDatabase
): ObserveIdentityFingerprint {
  return async (bindingRaw) => {
    const binding = requireObservableBinding(bindingRaw);

    // Hot path: the binding agrees with the stored fingerprint and carries
    // no newer minting time, so there is nothing to maintain. An older
    // MATCHING token is fine — only contradictions are ordered by mint time.
    const [current] = await getDb()
      .select()
      .from(identityFingerprints)
      .where(eq(identityFingerprints.crName, binding.crName))
      .limit(1);
    if (
      current != null &&
      current.userUid === binding.userUid &&
      current.mintedAt >= binding.mintedAt
    ) {
      return { outcome: "match" };
    }

    return getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(identityFingerprints)
        .values({
          crName: binding.crName,
          mintedAt: binding.mintedAt,
          userUid: binding.userUid,
        })
        .onConflictDoNothing({ target: identityFingerprints.crName })
        .returning({ crName: identityFingerprints.crName });
      if (inserted.length > 0) {
        return { outcome: "first_observation" };
      }

      // The row lock serializes concurrent observations for one crName, so
      // a merge decision cannot race a refresh or a second merge.
      const [row] = await tx
        .select()
        .from(identityFingerprints)
        .where(eq(identityFingerprints.crName, binding.crName))
        .for("update");
      if (row == null) {
        throw new Error("Identity fingerprint row disappeared mid-decision.");
      }

      if (row.userUid === binding.userUid) {
        if (binding.mintedAt > row.mintedAt) {
          await tx
            .update(identityFingerprints)
            .set({ mintedAt: binding.mintedAt, observedAt: new Date() })
            .where(eq(identityFingerprints.crName, binding.crName));
        }
        return { outcome: "match" };
      }

      // Minting-time monotonicity: only a strictly newer contradiction may
      // re-key. Anything else is a replayed pre-merge token — refused, with
      // nothing mutated.
      if (binding.mintedAt <= row.mintedAt) {
        return {
          observedMintedAt: row.mintedAt,
          observedUserUid: row.userUid,
          outcome: "superseded",
        };
      }

      await tx
        .update(identityFingerprints)
        .set({
          mintedAt: binding.mintedAt,
          observedAt: new Date(),
          userUid: binding.userUid,
        })
        .where(eq(identityFingerprints.crName, binding.crName));
      const rekeyed = await rekeyPersonalResources(tx, {
        survivorUserUid: binding.userUid,
        tombstoneUserUid: row.userUid,
      });
      console.info("[telemetry] account merge re-keyed personal resources", {
        crName: binding.crName,
        survivorUserUid: binding.userUid,
        tombstoneUserUid: row.userUid,
        ...rekeyed,
      });
      return { outcome: "merge" };
    });
  };
}

type AssistantPgTransaction = Parameters<
  Parameters<AssistantPgDatabase["transaction"]>[0]
>[0];

/**
 * Re-keys ALL personal resources from the tombstone uid to the surviving uid
 * (ADR-0059). Complete and idempotent because the tombstone uid can never be
 * minted again. `updatedAt` on conversations stays untouched so a merge never
 * reorders the thread picker; crName-keyed legacy rows are not touched here —
 * the existing lazy re-key adopts them for the surviving uid.
 */
async function rekeyPersonalResources(
  tx: AssistantPgTransaction,
  input: { survivorUserUid: string; tombstoneUserUid: string }
): Promise<{
  connectionsReleased: number;
  connectionsRekeyed: number;
  conversations: number;
}> {
  const conversations = await tx
    .update(assistantChats)
    .set({ workspaceActor: input.survivorUserUid })
    .where(eq(assistantChats.workspaceActor, input.tombstoneUserUid))
    .returning({ id: assistantChats.id });

  // Where the surviving uid already holds a connection in a namespace, that
  // authorization wins (the adoption precedent); the tombstone's row there
  // is released rather than left as permanently unreadable ciphertext.
  const survivorConnections = alias(
    githubOauthConnections,
    "survivor_connections"
  );
  const tombstoneConnectionWhere = and(
    eq(githubOauthConnections.workspaceActor, input.tombstoneUserUid),
    eq(
      githubOauthConnections.ownerIdentityVersion,
      CURRENT_GITHUB_OWNER_IDENTITY_VERSION
    )
  );
  const rekeyedConnections = await tx
    .update(githubOauthConnections)
    .set({ updatedAt: new Date(), workspaceActor: input.survivorUserUid })
    .where(
      and(
        tombstoneConnectionWhere,
        notExists(
          tx
            .select({ id: survivorConnections.id })
            .from(survivorConnections)
            .where(
              and(
                eq(
                  survivorConnections.namespace,
                  githubOauthConnections.namespace
                ),
                eq(survivorConnections.workspaceActor, input.survivorUserUid),
                eq(
                  survivorConnections.ownerIdentityVersion,
                  CURRENT_GITHUB_OWNER_IDENTITY_VERSION
                )
              )
            )
        )
      )
    )
    .returning({ id: githubOauthConnections.id });
  const releasedConnections = await tx
    .delete(githubOauthConnections)
    .where(tombstoneConnectionWhere)
    .returning({ id: githubOauthConnections.id });

  return {
    connectionsReleased: releasedConnections.length,
    connectionsRekeyed: rekeyedConnections.length,
    conversations: conversations.length,
  };
}
