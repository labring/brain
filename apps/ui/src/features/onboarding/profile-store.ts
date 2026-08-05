import { eq, notInArray } from "drizzle-orm";

import type { AssistantPgDatabase } from "@/features/chat/persistence/db";
import { requireCurrentIdentityBinding } from "@/lib/identity-fingerprint-core";

import { onboardingProfiles } from "./schema";
import type {
  OnboardingProfileStatus,
  OnboardingProfileTerminalState,
} from "./types";

/** The Sampled statuses (ADR-0061): the dialog never shows again. */
export const TERMINAL_ONBOARDING_PROFILE_STATUSES = [
  "completed",
  "dismissed",
] as const satisfies readonly OnboardingProfileStatus[];

const terminalStatuses: ReadonlySet<OnboardingProfileStatus> = new Set(
  TERMINAL_ONBOARDING_PROFILE_STATUSES
);

/** The actor writing their own profile: bare uid key + crName for the re-check. */
export interface OnboardingProfileActor {
  legacyWorkspaceActor: string;
  userUid: string;
}

export interface OnboardingProfileStore {
  /**
   * Terminal dismiss (Skip). Terminal wins: when the row is already
   * `completed` or `dismissed`, nothing is written and the pre-existing state
   * is returned, so fire-and-forget retries can never corrupt a terminal row.
   */
  dismiss(input: {
    actor: OnboardingProfileActor;
    dismissedAtStep: number;
  }): Promise<OnboardingProfileTerminalState>;
  /**
   * The sampling predicate (ADR-0061): `true` when a terminal row exists.
   * No row and `in_progress` both mean Unsampled.
   */
  isSampled(userUid: string): Promise<boolean>;
}

/**
 * Persistence for the Onboarding Profile. Takes the assistant Drizzle handle:
 * the profile table lives in `sealai_onboarding`, but it shares the database,
 * and the dismiss transaction must span the `identity_fingerprints` re-check
 * (ADR-0059) anyway.
 */
export function createOnboardingProfileStore(
  getDb: () => AssistantPgDatabase
): OnboardingProfileStore {
  return {
    dismiss: (input) =>
      getDb().transaction(async (tx) => {
        // The dismiss creates or finalizes a uid-keyed row; re-check the
        // fingerprint in the same transaction so a concurrent merge either
        // sweeps this row or refuses the stale binding (ADR-0059).
        await requireCurrentIdentityBinding(tx, {
          crName: input.actor.legacyWorkspaceActor,
          userUid: input.actor.userUid,
        });
        await tx
          .insert(onboardingProfiles)
          .values({
            dismissedAtStep: input.dismissedAtStep,
            status: "dismissed",
            userUid: input.actor.userUid,
          })
          .onConflictDoUpdate({
            // Answers already given stay persisted: only the terminal
            // columns are touched, never the per-step answer columns.
            set: {
              dismissedAtStep: input.dismissedAtStep,
              status: "dismissed",
              updatedAt: new Date(),
            },
            setWhere: notInArray(onboardingProfiles.status, [
              ...TERMINAL_ONBOARDING_PROFILE_STATUSES,
            ]),
            target: onboardingProfiles.userUid,
          });
        const [row] = await tx
          .select({
            dismissedAtStep: onboardingProfiles.dismissedAtStep,
            status: onboardingProfiles.status,
          })
          .from(onboardingProfiles)
          .where(eq(onboardingProfiles.userUid, input.actor.userUid));
        if (row == null || row.status === "in_progress") {
          throw new Error("Onboarding dismiss failed to settle terminally.");
        }
        return { dismissedAtStep: row.dismissedAtStep, status: row.status };
      }),
    isSampled: async (userUid) => {
      const [row] = await getDb()
        .select({ status: onboardingProfiles.status })
        .from(onboardingProfiles)
        .where(eq(onboardingProfiles.userUid, userUid))
        .limit(1);
      return row != null && terminalStatuses.has(row.status);
    },
  };
}
