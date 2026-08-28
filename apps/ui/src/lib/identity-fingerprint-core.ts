import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  AssistantPgDatabase,
  AssistantPgTransaction,
} from "@/features/chat/persistence/db";
import {
  assistantChats,
  githubAppInstallSessions,
  githubOauthConnections,
  identityFingerprints,
} from "@/features/chat/persistence/schema";
import { CURRENT_GITHUB_OWNER_IDENTITY_VERSION } from "@/features/deploy/github/owner-identity";
import { deployTasks } from "@/features/deploy/task/schema";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "@/features/marketing/schema";
import {
  notificationMessages,
  notificationReadReceipts,
} from "@/features/notifications/schema";
import { onboardingProfiles } from "@/features/onboarding/schema";
import { rekeyCanonicalIdentityUids } from "@/lib/identity-uid-canonicalization";

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

/**
 * A write-time re-check found the request's binding no longer current: the
 * crName was re-pointed by an account merge after authorization observed it.
 * HTTP handlers map this to the same 401 as an authorization-time superseded
 * token — the desktop re-login loop re-mints a current token.
 */
export class IdentityBindingSupersededError extends Error {
  constructor() {
    super("The verified identity binding was superseded by an account merge.");
    this.name = "IdentityBindingSupersededError";
  }
}

/**
 * Serializes a personal-resource write with the merge decision (ADR-0059).
 * Must run inside the same transaction that creates or adopts uid-keyed rows:
 * the fingerprint decision and the resource write are separate transactions,
 * so a request that authorized before a merge could otherwise commit
 * tombstone-keyed rows after the merge's re-key sweep — invisible to the
 * surviving uid forever. `FOR SHARE` on the crName row orders this
 * transaction against the merge's `FOR UPDATE`: either the guarded write
 * commits first and the sweep re-keys it, or the merge wins and the stale
 * binding is refused here.
 */
export async function requireCurrentIdentityBinding(
  tx: Pick<AssistantPgTransaction, "select">,
  binding: { crName: string; userUid: string }
): Promise<void> {
  const crName = binding.crName.trim();
  const userUid = binding.userUid.trim();
  if (crName === "" || userUid === "") {
    throw new Error("A verified identity binding is required.");
  }
  const [row] = await tx
    .select({ userUid: identityFingerprints.userUid })
    .from(identityFingerprints)
    .where(eq(identityFingerprints.crName, crName))
    .for("share");
  // Authorization observes the fingerprint before any personal-resource
  // write, so the row exists on every legal path; a missing row fails closed.
  if (row == null || row.userUid !== userUid) {
    throw new IdentityBindingSupersededError();
  }
}

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
    // Lock-free is sound because this outcome only gates authorization: every
    // transaction that later creates or adopts uid-keyed rows re-checks the
    // fingerprint via requireCurrentIdentityBinding, which serializes with
    // the merge transaction's row lock below.
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
  attributionSubjectsRekeyed: number;
  attributionSubjectsReleased: number;
  connectionsReleased: number;
  connectionsRekeyed: number;
  conversations: number;
  deployAttributionProvenanceRekeyed: number;
  identityUidCanonicalizationsRekeyed: number;
  installSessionsRekeyed: number;
  lifecycleEventsRekeyed: number;
  messagesReleased: number;
  messagesRekeyed: number;
  profilesReleased: number;
  profilesRekeyed: number;
  receiptsReleased: number;
  receiptsRekeyed: number;
}> {
  const identityUidCanonicalizationsRekeyed = await rekeyCanonicalIdentityUids(
    tx,
    input
  );

  // Pending authorization sessions are swept BEFORE connections: the OAuth
  // callback consumes its session row under a row lock and writes the
  // connection in that same transaction, with no crName left to re-check.
  // Sweeping sessions first orders the two — the callback either blocks on
  // its re-keyed session and re-reads the survivor uid, or commits its
  // connection row before the sweep below, which then re-keys it.
  const rekeyedInstallSessions = await tx
    .update(githubAppInstallSessions)
    .set({ workspaceActor: input.survivorUserUid })
    .where(
      and(
        eq(githubAppInstallSessions.workspaceActor, input.tombstoneUserUid),
        eq(
          githubAppInstallSessions.ownerIdentityVersion,
          CURRENT_GITHUB_OWNER_IDENTITY_VERSION
        )
      )
    )
    .returning({ state: githubAppInstallSessions.state });

  const conversations = await tx
    .update(assistantChats)
    .set({ workspaceActor: input.survivorUserUid })
    .where(eq(assistantChats.workspaceActor, input.tombstoneUserUid))
    .returning({ id: assistantChats.id });

  const rekeyedDeployAttributionProvenance = await tx
    .update(deployTasks)
    .set({
      marketingAttribution: sql`jsonb_set(
        ${deployTasks.marketingAttribution},
        '{consent_provenance,subject_id}',
        to_jsonb(${input.survivorUserUid}::text),
        false
      )`,
    })
    .where(
      sql`${deployTasks.marketingAttribution} -> 'consent_provenance' ->> 'subject_id' = ${input.tombstoneUserUid}`
    )
    .returning({ id: deployTasks.id });

  // All local lifecycle rows follow the survivor.
  const rekeyedLifecycleEvents = await tx
    .update(marketingLifecycleEvents)
    .set({
      consentProvenance: sql`CASE
        WHEN ${marketingLifecycleEvents.consentProvenance} ->> 'subject_id' = ${input.tombstoneUserUid}
          THEN jsonb_set(
            ${marketingLifecycleEvents.consentProvenance},
            '{subject_id}',
            to_jsonb(${input.survivorUserUid}::text),
            false
          )
        ELSE ${marketingLifecycleEvents.consentProvenance}
      END`,
      userId: input.survivorUserUid,
    })
    .where(eq(marketingLifecycleEvents.userId, input.tombstoneUserUid))
    .returning({ eventId: marketingLifecycleEvents.eventId });

  const survivorAttributionSubjects = alias(
    marketingAttributionSubjects,
    "survivor_attribution_subjects"
  );
  const tombstoneAttributionSubjectWhere = and(
    eq(marketingAttributionSubjects.subjectType, "user"),
    eq(marketingAttributionSubjects.subjectId, input.tombstoneUserUid)
  );
  const rekeyedAttributionSubjects = await tx
    .update(marketingAttributionSubjects)
    .set({
      consentProvenance: sql`CASE
        WHEN ${marketingAttributionSubjects.consentProvenance} ->> 'subject_id' = ${input.tombstoneUserUid}
          THEN jsonb_set(
            ${marketingAttributionSubjects.consentProvenance},
            '{subject_id}',
            to_jsonb(${input.survivorUserUid}::text),
            false
          )
        ELSE ${marketingAttributionSubjects.consentProvenance}
      END`,
      subjectId: input.survivorUserUid,
    })
    .where(
      and(
        tombstoneAttributionSubjectWhere,
        notExists(
          tx
            .select({ subjectId: survivorAttributionSubjects.subjectId })
            .from(survivorAttributionSubjects)
            .where(
              and(
                eq(survivorAttributionSubjects.subjectType, "user"),
                eq(survivorAttributionSubjects.subjectId, input.survivorUserUid)
              )
            )
        )
      )
    )
    .returning({ subjectId: marketingAttributionSubjects.subjectId });
  const releasedAttributionSubjects = await tx
    .delete(marketingAttributionSubjects)
    .where(tombstoneAttributionSubjectWhere)
    .returning({ subjectId: marketingAttributionSubjects.subjectId });

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

  // The Onboarding Profile is keyed by the bare uid alone (ADR-0061): the
  // tombstone's row follows the survivor only where the survivor holds none;
  // otherwise the survivor's row is authoritative and the tombstone's is
  // deleted — one row per person, no answer-level merging. `updatedAt`
  // doubles as the terminal timestamp, so a re-key never touches it.
  const survivorProfiles = alias(onboardingProfiles, "survivor_profiles");
  const rekeyedProfiles = await tx
    .update(onboardingProfiles)
    .set({ userUid: input.survivorUserUid })
    .where(
      and(
        eq(onboardingProfiles.userUid, input.tombstoneUserUid),
        notExists(
          tx
            .select({ userUid: survivorProfiles.userUid })
            .from(survivorProfiles)
            .where(eq(survivorProfiles.userUid, input.survivorUserUid))
        )
      )
    )
    .returning({ userUid: onboardingProfiles.userUid });
  const releasedProfiles = await tx
    .delete(onboardingProfiles)
    .where(eq(onboardingProfiles.userUid, input.tombstoneUserUid))
    .returning({ userUid: onboardingProfiles.userUid });

  // Notification read receipts are keyed by (uid, message key): the
  // tombstone's receipts follow the survivor except where the survivor
  // already read the same message, and the rest are deleted — a receipt is
  // a fact about one person, so two rows for one message collapse to one.
  const survivorReceipts = alias(notificationReadReceipts, "survivor_receipts");
  const rekeyedReceipts = await tx
    .update(notificationReadReceipts)
    .set({ userUid: input.survivorUserUid })
    .where(
      and(
        eq(notificationReadReceipts.userUid, input.tombstoneUserUid),
        notExists(
          tx
            .select({ userUid: survivorReceipts.userUid })
            .from(survivorReceipts)
            .where(
              and(
                eq(survivorReceipts.userUid, input.survivorUserUid),
                eq(
                  survivorReceipts.messageKey,
                  notificationReadReceipts.messageKey
                )
              )
            )
        )
      )
    )
    .returning({ messageKey: notificationReadReceipts.messageKey });
  const releasedReceipts = await tx
    .delete(notificationReadReceipts)
    .where(eq(notificationReadReceipts.userUid, input.tombstoneUserUid))
    .returning({ messageKey: notificationReadReceipts.messageKey });

  // Account-scoped notification messages (ADR-0067: the gift hint) are
  // uid-keyed rows whose dedupe key names the uid too, so the key moves with
  // the row — a later observation then finds the survivor's row instead of
  // writing a second welcome. Where the survivor already holds a live row
  // under the re-keyed name, the tombstone's is a duplicate of the same
  // one-per-person fact and is deleted (its receipts cascade).
  const survivorDedupeKey = sql<string>`replace(${notificationMessages.dedupeKey}, ${input.tombstoneUserUid}, ${input.survivorUserUid})`;
  const survivorMessages = alias(notificationMessages, "survivor_messages");
  const rekeyedMessages = await tx
    .update(notificationMessages)
    .set({ dedupeKey: survivorDedupeKey, userUid: input.survivorUserUid })
    .where(
      and(
        eq(notificationMessages.userUid, input.tombstoneUserUid),
        notExists(
          tx
            .select({ id: survivorMessages.id })
            .from(survivorMessages)
            .where(
              and(
                eq(survivorMessages.userUid, input.survivorUserUid),
                isNull(survivorMessages.releasedAt),
                eq(survivorMessages.dedupeKey, survivorDedupeKey)
              )
            )
        )
      )
    )
    .returning({ id: notificationMessages.id });
  const releasedMessages = await tx
    .delete(notificationMessages)
    .where(eq(notificationMessages.userUid, input.tombstoneUserUid))
    .returning({ id: notificationMessages.id });

  return {
    attributionSubjectsRekeyed: rekeyedAttributionSubjects.length,
    attributionSubjectsReleased: releasedAttributionSubjects.length,
    connectionsReleased: releasedConnections.length,
    connectionsRekeyed: rekeyedConnections.length,
    conversations: conversations.length,
    deployAttributionProvenanceRekeyed:
      rekeyedDeployAttributionProvenance.length,
    identityUidCanonicalizationsRekeyed,
    installSessionsRekeyed: rekeyedInstallSessions.length,
    lifecycleEventsRekeyed: rekeyedLifecycleEvents.length,
    messagesReleased: releasedMessages.length,
    messagesRekeyed: rekeyedMessages.length,
    profilesReleased: releasedProfiles.length,
    profilesRekeyed: rekeyedProfiles.length,
    receiptsReleased: releasedReceipts.length,
    receiptsRekeyed: rekeyedReceipts.length,
  };
}
