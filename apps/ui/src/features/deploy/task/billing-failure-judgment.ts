import "server-only";

import { judgeWorkspaceBillingStandingForActor } from "@/features/billing/server/billing-standing";

import {
  type BillingFailureOverride,
  resolveBillingFailureOverride,
} from "./billing-failure";
import type { DeployTaskFailureReason } from "./schema";

/**
 * The verified account identity a deployment run carries in request memory
 * (never persisted, like the kubeconfig) so its terminal failure can ask
 * account-service what the platform thinks of the workspace (ADR-0060).
 * Absent when the launching request had no verifiable actor: the failure
 * then keeps the runner's own classification.
 */
export interface DeployBillingActor {
  /** Cookie header of the launching request — carries the billing Dev Mock in dev/demo. */
  cookieHeader?: string | null;
  userId: string | null;
  userUid: string;
}

/**
 * Runs the reverse-check for one failing run. Every failure path resolves
 * null: the terminal write must never wait on billing.
 */
export async function judgeDeployBillingFailure(input: {
  actor: DeployBillingActor | undefined;
  namespace: string;
  reason: DeployTaskFailureReason | null;
}): Promise<BillingFailureOverride | null> {
  if (input.actor == null || input.actor.userUid.trim() === "") {
    return null;
  }
  try {
    const standing = await judgeWorkspaceBillingStandingForActor({
      cookieHeader: input.actor.cookieHeader,
      userId: input.actor.userId,
      userUid: input.actor.userUid,
      workspace: input.namespace,
    });
    return resolveBillingFailureOverride({
      now: new Date(),
      reason: input.reason,
      standing,
    });
  } catch {
    return null;
  }
}
