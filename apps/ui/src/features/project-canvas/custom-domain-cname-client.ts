"use client";

import type { ContainerCustomDomainCnameVerifier } from "@workspace/ui/components/container-settings-pane/container-settings-pane";

const CNAME_VERIFY_PATH = "/api/project-canvas/custom-domain/cname";

interface CnameVerifyResponse {
  message?: string;
  ok?: boolean;
  reason?: string;
}

export const verifyCustomDomainCnameFromApi: ContainerCustomDomainCnameVerifier =
  async ({ domain, target }) => {
    const response = await fetch(CNAME_VERIFY_PATH, {
      body: JSON.stringify({ domain, target }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response
      .json()
      .catch(() => ({}))) as CnameVerifyResponse;
    if (typeof body.ok === "boolean") {
      return {
        ok: body.ok,
        ...(body.message == null ? {} : { message: body.message }),
        ...(body.reason == null ? {} : { reason: body.reason }),
      };
    }
    return {
      message: response.ok
        ? "CNAME verification failed."
        : "CNAME verification is unavailable.",
      ok: false,
      reason: "unavailable",
    };
  };
