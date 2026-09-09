import "server-only";

import {
  parseWorkspaceOwnerStanding,
  UNKNOWN_WORKSPACE_OWNER_STANDING,
  type WorkspaceOwnerStanding,
} from "@/features/billing/workspace-owner";
import { requestAccountService } from "@/lib/account-service/client";
import { isAccountServiceConfigured } from "@/lib/account-service/config";

import type { WorkspaceBillingStanding } from "./billing-standing-core";
import {
  type BillingPayloadFetch,
  readWorkspaceBillingStanding,
  type WorkspaceOwnerStandingRead,
} from "./billing-standing-reader";
import { WORKSPACE_OWNER_FIXTURE_PATHNAME } from "./dev-fixtures/pathnames";
import { BILLING_JUDGMENT_TIMEOUT_MS } from "./judgment-budget";
import { readWorkspaceOwnerStanding } from "./workspace-owner-reader";

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
   * The verified app-token `userCrName` (ADR-0082): the Workspace Owner
   * judgment compares it with the namespace's owner label. Null leaves
   * ownership unknown, which keeps the caller's balance out of the verdict.
   */
  crName: string | null;
  /**
   * The request kubeconfig, URL-encoded as the routes hold it — the
   * Namespace object is read with it. Null skips the read (unknown owner).
   */
  encodedKubeconfig: string | null;
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
    new Request("http://brain.internal/billing-dev-mock", {
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

/** The Workspace Owner read: the dev mock's fixture first, else the namespace. */
function ownerRead(
  input: WorkspaceBillingStandingInput,
  signal: AbortSignal
): WorkspaceOwnerStandingRead {
  return async (): Promise<WorkspaceOwnerStanding> => {
    const mocked = await devMockPayload(
      WORKSPACE_OWNER_FIXTURE_PATHNAME,
      { workspace: input.workspace },
      input.cookieHeader
    );
    if (mocked != null) {
      return mocked.ok
        ? parseWorkspaceOwnerStanding(await mocked.json())
        : UNKNOWN_WORKSPACE_OWNER_STANDING;
    }
    const encodedKubeconfig = input.encodedKubeconfig?.trim() ?? "";
    if (encodedKubeconfig === "") {
      return UNKNOWN_WORKSPACE_OWNER_STANDING;
    }
    return await readWorkspaceOwnerStanding({
      crName: input.crName,
      encodedKubeconfig,
      namespace: input.workspace,
      signal,
    });
  };
}

/**
 * The workspace's live billing standing for one verified actor: four
 * in-cluster reads plus the Workspace Owner read under one budget, every
 * failure path resolving to unknown. Shared by the paid-chat gate (E3),
 * the deployment failure reverse-check (E1/E2), and the assistant's deploy
 * tool so none of them can name a different account (ADR-0082).
 */
export function judgeWorkspaceBillingStandingForActor(
  input: WorkspaceBillingStandingInput
): Promise<WorkspaceBillingStanding> {
  const signal =
    input.signal ?? AbortSignal.timeout(BILLING_JUDGMENT_TIMEOUT_MS);
  return readWorkspaceBillingStanding(
    {
      regionDomain: process.env.BILLING_LOCAL_REGION_DOMAIN?.trim() ?? "",
      workspace: input.workspace,
    },
    payloadFetch({ ...input, signal }),
    ownerRead(input, signal)
  );
}
