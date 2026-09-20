import "server-only";

/**
 * Decodes a JWT payload without verifying it. Brain holds no Desktop
 * regional key (ADR-0083), so a token Desktop just returned is trusted for
 * its claims exactly as Desktop's own frontend trusts it (`jwtDecode`).
 * Never use this for a token that arrived from the browser.
 */
export function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1] == null || parts[1] === "") {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return typeof payload === "object" &&
      payload != null &&
      !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function claimString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

/** The Desktop `AccessTokenPayload` claims Brain reads off a regional token. */
export interface RegionalTokenClaims {
  userCrName: string;
  userId: string;
  userUid: string;
  workspaceId: string;
  workspaceUid: string;
}

export function regionalTokenClaims(token: string): RegionalTokenClaims | null {
  const payload = decodeJwtPayload(token);
  if (payload == null) {
    return null;
  }
  return {
    userCrName: claimString(payload, "userCrName"),
    userId: claimString(payload, "userId"),
    userUid: claimString(payload, "userUid"),
    workspaceId: claimString(payload, "workspaceId"),
    workspaceUid: claimString(payload, "workspaceUid"),
  };
}
