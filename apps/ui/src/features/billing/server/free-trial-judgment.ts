import "server-only";

import { requestAccountService } from "@/lib/account-service/client";
import { isAccountServiceConfigured } from "@/lib/account-service/config";
import {
  type FreeTrialJudgment,
  judgeFreeTrialFromSubscriptionInfo,
} from "@/lib/account-service/free-trial-core";

const SUBSCRIPTION_INFO_PATHNAME =
  "/account/v1alpha1/workspace-subscription/info";

/**
 * The judgment runs under a seconds-long LLM turn; a slow account service
 * must degrade to fail-open, never stall the turn (ADR-0065).
 */
const JUDGMENT_TIMEOUT_MS = 5000;

export interface ActiveFreeTrialJudgmentInput {
  /**
   * Cookie header of the triggering request. In dev/demo builds it carries
   * the billing dev-mock scenario so mock scenarios drive Chat Billing
   * Posture exactly like they drive the /api/billing routes.
   */
  cookieHeader?: string | null;
  userId: string | null;
  userUid: string;
  workspace: string;
}

async function devMockSubscriptionInfo(
  body: string,
  cookieHeader: string | null | undefined
): Promise<Response | null> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return null;
  }
  const { billingDevMockResponse } = await import("./dev-fixtures");
  return billingDevMockResponse(
    SUBSCRIPTION_INFO_PATHNAME,
    new Request(`http://brain.internal${SUBSCRIPTION_INFO_PATHNAME}`, {
      body,
      headers: cookieHeader == null ? undefined : { cookie: cookieHeader },
      method: "POST",
    })
  );
}

async function judgeResponse(response: Response): Promise<FreeTrialJudgment> {
  if (!response.ok) {
    return "unknown";
  }
  const payload: unknown = await response.json().catch(() => null);
  return judgeFreeTrialFromSubscriptionInfo(payload);
}

/**
 * Live Active Free Trial judgment for one chat request (ADR-0065): one
 * HS256-signed in-cluster POST to account-service subscription/info, no
 * cross-turn cache. Every failure path — missing configuration, missing
 * identity, timeout, upstream error, unparsable body — resolves `unknown`
 * (fail-open); blocking may only ever happen on a confirmed `trial`.
 */
export async function judgeActiveFreeTrialForWorkspace(
  input: ActiveFreeTrialJudgmentInput
): Promise<FreeTrialJudgment> {
  const regionDomain = process.env.BILLING_LOCAL_REGION_DOMAIN?.trim() ?? "";
  const body = JSON.stringify({ regionDomain, workspace: input.workspace });

  try {
    const mocked = await devMockSubscriptionInfo(body, input.cookieHeader);
    if (mocked != null) {
      return await judgeResponse(mocked);
    }

    if (
      !isAccountServiceConfigured() ||
      regionDomain === "" ||
      (input.userId?.trim() ?? "") === "" ||
      input.userUid.trim() === ""
    ) {
      return "unknown";
    }
    const response = await requestAccountService({
      actor: { userId: input.userId, userUid: input.userUid },
      init: {
        body,
        method: "POST",
        signal: AbortSignal.timeout(JUDGMENT_TIMEOUT_MS),
      },
      pathname: SUBSCRIPTION_INFO_PATHNAME,
    });
    return await judgeResponse(response);
  } catch {
    return "unknown";
  }
}
