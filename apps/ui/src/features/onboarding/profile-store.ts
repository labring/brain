import { eq, notInArray } from "drizzle-orm";

import type { AssistantPgDatabase } from "@/features/chat/persistence/db";
import { requireCurrentIdentityBinding } from "@/lib/identity-fingerprint-core";

import { onboardingProfiles } from "./schema";
import type {
  OnboardingPriorityTag,
  OnboardingProfileStatus,
  OnboardingProfileTerminalState,
  OnboardingProfileWriteState,
  OnboardingRoleType,
  OnboardingUsageContext,
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

/**
 * The answer columns one stepwise write may touch. A step always writes its
 * full column set, so a re-answer can never leave stale Other text behind.
 */
export interface OnboardingStepAnswerColumns {
  priorityDisplayOrder?: OnboardingPriorityTag[];
  priorityOtherText?: string | null;
  priorityTags?: OnboardingPriorityTag[];
  roleOtherText?: string | null;
  roleType?: OnboardingRoleType;
  usageContext?: OnboardingUsageContext;
  usageOtherText?: string | null;
}

export interface OnboardingProfileStore {
  /**
   * Stepwise answer upsert: creates or updates the row with
   * `status: in_progress`. Terminal wins — against a `completed` or
   * `dismissed` row nothing is written and the terminal status is reported,
   * so fire-and-forget retries can never corrupt a terminal row.
   */
  answerStep(input: {
    actor: OnboardingProfileActor;
    answers: OnboardingStepAnswerColumns;
  }): Promise<OnboardingProfileWriteState>;
  /**
   * Terminal complete (Submit & Enter Console): finalizes the row with
   * `status: completed` and the optional Step 4 open goal. Terminal wins —
   * against a row already `completed` or `dismissed`, nothing is written and
   * the pre-existing state is returned.
   */
  complete(input: {
    actor: OnboardingProfileActor;
    openGoalText: string | null;
  }): Promise<OnboardingProfileTerminalState>;
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
    answerStep: (input) =>
      getDb().transaction(async (tx) => {
        // Same discipline as dismiss: the write lands on a uid-keyed row, so
        // re-check the fingerprint in the same transaction (ADR-0059).
        await requireCurrentIdentityBinding(tx, {
          crName: input.actor.legacyWorkspaceActor,
          userUid: input.actor.userUid,
        });
        await tx
          .insert(onboardingProfiles)
          .values({
            ...input.answers,
            status: "in_progress",
            userUid: input.actor.userUid,
          })
          .onConflictDoUpdate({
            // A live row keeps its `in_progress` status; only the step's own
            // answer columns move, so earlier steps' answers accumulate.
            set: { ...input.answers, updatedAt: new Date() },
            setWhere: notInArray(onboardingProfiles.status, [
              ...TERMINAL_ONBOARDING_PROFILE_STATUSES,
            ]),
            target: onboardingProfiles.userUid,
          });
        const [row] = await tx
          .select({ status: onboardingProfiles.status })
          .from(onboardingProfiles)
          .where(eq(onboardingProfiles.userUid, input.actor.userUid));
        if (row == null) {
          throw new Error("Onboarding step answer failed to persist.");
        }
        return { status: row.status };
      }),
    complete: (input) =>
      getDb().transaction(async (tx) => {
        // Same discipline as dismiss: the terminal write lands on a uid-keyed
        // row, so re-check the fingerprint in the same transaction (ADR-0059).
        await requireCurrentIdentityBinding(tx, {
          crName: input.actor.legacyWorkspaceActor,
          userUid: input.actor.userUid,
        });
        await tx
          .insert(onboardingProfiles)
          .values({
            openGoalText: input.openGoalText,
            status: "completed",
            userUid: input.actor.userUid,
          })
          .onConflictDoUpdate({
            // Answers already given stay persisted: completing touches only
            // its own columns, never the per-step answer columns.
            set: {
              openGoalText: input.openGoalText,
              status: "completed",
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
          throw new Error("Onboarding complete failed to settle terminally.");
        }
        return { dismissedAtStep: row.dismissedAtStep, status: row.status };
      }),
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
