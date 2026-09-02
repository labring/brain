import "server-only";

import { requestAccountService } from "@/lib/account-service/client";
import { isAccountServiceConfigured } from "@/lib/account-service/config";

import type { WorkspaceBillingStanding } from "./billing-standing-core";
import {
  type BillingPayloadFetch,
  readWorkspaceBillingStanding,
} from "./billing-standing-reader";
import { BILLING_JUDGMENT_TIMEOUT_MS } from "./judgment-budget";

export type {
  WorkspaceAiPaidSource,
  WorkspaceBillingStanding,
} from "./billing-standing-core";

export interface WorkspaceBillingStandingInput {
  /**
   * Cookie header of the triggering request. In dev/demo builds it carries
   * the billing Dev Mock scenario so mock scenarios drive the gate and the
   * reverse-check exactly like they drive the /api/billing routes.
   */
  cookieHeader?: string | null;
  /**
   * The caller's deadline when the reads share a budget with the free-trial
   * judgment (ADR-0068). On their own — a deployment's terminal failure
   * write, the assistant's deploy tool — they run under the same budget
   * alone; a slow account service degrades to unknown, never stalls.
   */
  signal?: AbortSignal;
  userId: string | null;
  userUid: string;
  workspace: string;
}

function devMockEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
  );
}

async function devMockPayload(
  pathname: string,
  body: Record<string, unknown>,
  cookieHeader: string | null | undefined
): Promise<Response | null> {
  if (!devMockEnabled()) {
    return null;
  }
  const { billingDevMockResponse } = await import("./dev-fixtures");
  return billingDevMockResponse(
    pathname,
    new Request(`http://brain.internal${pathname}`, {
      body: JSON.stringify(body),
      headers: cookieHeader == null ? undefined : { cookie: cookieHeader },
      method: "POST",
    })
  );
}

function payloadFetch(
  input: WorkspaceBillingStandingInput
): BillingPayloadFetch {
  const userId = input.userId?.trim() ?? "";
  const userUid = input.userUid.trim();
  const signal =
    input.signal ?? AbortSignal.timeout(BILLING_JUDGMENT_TIMEOUT_MS);
  return async (pathname, body) => {
    const mocked = await devMockPayload(pathname, body, input.cookieHeader);
    if (mocked != null) {
      return mocked.ok ? await mocked.json() : null;
    }
    if (!isAccountServiceConfigured() || userId === "" || userUid === "") {
      return null;
    }
    const response = await requestAccountService({
      actor: { userId, userUid },
      init: {
        body: JSON.stringify(body),
        method: "POST",
        signal,
      },
      pathname,
    });
    return response.ok ? await response.json() : null;
  };
}

/**
 * The workspace's live billing standing for one verified actor: four
 * in-cluster reads under one budget, every failure path resolving to
 * unknown. Shared by the paid-chat gate (E3) and the deployment failure
 * reverse-check (E1/E2) so the two never disagree.
 */
export function judgeWorkspaceBillingStandingForActor(
  input: WorkspaceBillingStandingInput
): Promise<WorkspaceBillingStanding> {
  return readWorkspaceBillingStanding(
    {
      regionDomain: process.env.BILLING_LOCAL_REGION_DOMAIN?.trim() ?? "",
      workspace: input.workspace,
    },
    payloadFetch(input)
  );
}
