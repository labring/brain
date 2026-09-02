import "server-only";

import { judgeWorkspaceBillingStandingForActor } from "@/features/billing/server/billing-standing";
import { UNKNOWN_BILLING_STANDING } from "@/features/billing/server/billing-standing-core";
import { judgeActiveFreeTrialForWorkspace } from "@/features/billing/server/free-trial-judgment";
import { BILLING_JUDGMENT_TIMEOUT_MS } from "@/features/billing/server/judgment-budget";
import type { FreeTrialJudgment } from "@/lib/account-service/free-trial-core";

import {
  type FreeTierSnapshot,
  getFreeTierSnapshot,
  isSystemOpenAiConfigured,
} from "./free-tier";
import { freeTierPosture } from "./free-tier-core";
import { type PaidChatWall, paidChatWall } from "./paid-chat-wall";
import type { FreeTierState } from "./types";

/**
 * The live billing facts one chat request is judged on (ADR-0065, ADR-0068,
 * ADR-0069): the local free-turn snapshot, the Active Free Trial judgment,
 * and — for a `user` posture only, whether this turn's or the post-turn one
 * the last free turn reports — the Paid Chat Wall. The trial judgment and
 * the four standing reads leave together under ONE budget, so an
 * unanswering account service costs the request at most that budget before
 * every read fails open; a `free` turn with turns to spare simply never
 * consults the standing it read.
 */

export interface ChatBillingActor {
  accountUserId: string | null;
  /** Cookie header of the request — carries the billing Dev Mock in dev/demo. */
  cookieHeader?: string | null;
  namespace: string;
  userUid: string;
}

export interface ChatBillingJudgment {
  /**
   * The Paid Chat Wall (design spec row E3) from the standing read that
   * left beside the trial judgment. Unknown standing fails open.
   */
  paidWall: () => Promise<PaidChatWall>;
  snapshot: FreeTierSnapshot;
  systemModelConfigured: boolean;
  trial: FreeTrialJudgment;
}

export interface ChatBillingJudgmentDependencies {
  isSystemOpenAiConfigured?: typeof isSystemOpenAiConfigured;
  judgeActiveFreeTrialForWorkspace?: typeof judgeActiveFreeTrialForWorkspace;
  judgeWorkspaceBillingStandingForActor?: typeof judgeWorkspaceBillingStandingForActor;
  readFreeTierSnapshot?: typeof getFreeTierSnapshot;
}

export async function judgeChatBilling(
  actor: ChatBillingActor,
  dependencies: ChatBillingJudgmentDependencies = {}
): Promise<ChatBillingJudgment> {
  const judgeStanding =
    dependencies.judgeWorkspaceBillingStandingForActor ??
    judgeWorkspaceBillingStandingForActor;
  const judgeTrial =
    dependencies.judgeActiveFreeTrialForWorkspace ??
    judgeActiveFreeTrialForWorkspace;
  const readSnapshot = dependencies.readFreeTierSnapshot ?? getFreeTierSnapshot;
  const systemModelConfigured = (
    dependencies.isSystemOpenAiConfigured ?? isSystemOpenAiConfigured
  )();
  const reads = {
    cookieHeader: actor.cookieHeader,
    signal: AbortSignal.timeout(BILLING_JUDGMENT_TIMEOUT_MS),
    userId: actor.accountUserId,
    userUid: actor.userUid,
    workspace: actor.namespace,
  };
  // Leaves first so it overlaps the snapshot and the trial judgment; a
  // rejection settles to unknown here so a `free` turn that never awaits it
  // cannot surface an unhandled rejection.
  const standing = judgeStanding(reads).catch(() => UNKNOWN_BILLING_STANDING);
  const snapshot = await readSnapshot(actor.namespace);
  // Skipped when the feature cannot produce anything but `user` anyway (no
  // platform model, or `FREE_CHAT_TURNS=0`).
  const trial =
    snapshot.limit > 0 && systemModelConfigured
      ? await judgeTrial(reads)
      : "not-trial";
  return {
    paidWall: async () => paidChatWall(await standing, trial),
    snapshot,
    systemModelConfigured,
    trial,
  };
}

/** A `user` posture spends AI Credits or the Account Balance: only it is walled. */
export async function withPaidChatWall(
  posture: FreeTierState,
  judgment: ChatBillingJudgment
): Promise<FreeTierState> {
  if (posture.billing !== "user") {
    return posture;
  }
  return { ...posture, ...(await judgment.paidWall()) };
}

/**
 * Chat Billing Posture for one verified actor at session bootstrap: the
 * pane locks on the paid wall before the first refused send, exactly like
 * the free allowance.
 */
export async function resolveFreeTierPosture(
  actor: ChatBillingActor,
  dependencies: ChatBillingJudgmentDependencies = {}
): Promise<FreeTierState> {
  const judgment = await judgeChatBilling(actor, dependencies);
  return withPaidChatWall(
    freeTierPosture(
      judgment.snapshot,
      judgment.systemModelConfigured,
      judgment.trial
    ),
    judgment
  );
}
