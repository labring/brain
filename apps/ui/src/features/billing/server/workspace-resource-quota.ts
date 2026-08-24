import "server-only";

import { requestAccountService } from "@/lib/account-service/client";
import { isAccountServiceConfigured } from "@/lib/account-service/config";
import {
  parseWorkspaceResourceQuotaPayload,
  unavailableWorkspaceResourceQuota,
  type WorkspaceResourceQuotaSnapshot,
} from "../workspace-resource-quota";

const WORKSPACE_QUOTA_PATHNAME =
  "/account/v1alpha1/workspace/get-resource-quota";
const QUOTA_TIMEOUT_MS = 5000;

async function devMockWorkspaceQuota(
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
    WORKSPACE_QUOTA_PATHNAME,
    new Request(`http://brain.internal${WORKSPACE_QUOTA_PATHNAME}`, {
      body,
      headers: cookieHeader == null ? undefined : { cookie: cookieHeader },
      method: "POST",
    })
  );
}

async function readQuotaResponse(
  response: Response
): Promise<WorkspaceResourceQuotaSnapshot> {
  if (!response.ok) {
    return unavailableWorkspaceResourceQuota();
  }
  try {
    return parseWorkspaceResourceQuotaPayload(await response.json());
  } catch {
    return unavailableWorkspaceResourceQuota();
  }
}

/**
 * Loads the current workspace resource usage for model context. Failures stay
 * informational: they render placeholders and never block an otherwise valid
 * assistant turn.
 */
export async function loadWorkspaceResourceQuota(input: {
  cookieHeader?: string | null;
  userId: string | null;
  userUid: string;
  workspace: string;
}): Promise<WorkspaceResourceQuotaSnapshot> {
  const userId = input.userId?.trim() ?? "";
  const userUid = input.userUid.trim();
  const workspace = input.workspace.trim();
  const body = JSON.stringify({ workspace });
  try {
    const mocked = await devMockWorkspaceQuota(body, input.cookieHeader);
    if (mocked != null) {
      return await readQuotaResponse(mocked);
    }

    if (
      !isAccountServiceConfigured() ||
      userId === "" ||
      userUid === "" ||
      workspace === ""
    ) {
      return unavailableWorkspaceResourceQuota();
    }

    const response = await requestAccountService({
      actor: { userId, userUid },
      init: {
        body,
        method: "POST",
        signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
      },
      pathname: WORKSPACE_QUOTA_PATHNAME,
    });
    return await readQuotaResponse(response);
  } catch {
    return unavailableWorkspaceResourceQuota();
  }
}
