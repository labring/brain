import {
  type PersonalResourceCredentials,
  personalResourceAuthHeaders,
} from "@/lib/personal-resource-headers";

export type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type BillingCredentials = PersonalResourceCredentials;

interface BillingJsonRequesterOptions {
  credentials: BillingCredentials;
  fallbackErrorMessage: string;
  fetch: BillingFetch;
}

export class BillingRequestError extends Error {
  readonly payload: unknown;
  readonly status: number;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "BillingRequestError";
    this.payload = payload;
    this.status = status;
  }
}

// A 403 on a billing route is a permission verdict — account-service turning
// down a non-owner's billing action (AIM-257) — not a transport failure, so
// it is voiced as one instead of echoing upstream internals. The role for
// PAYG workspaces is unknown client-side until AIM-268, which makes this
// rejection an expected first contact with the truth.
export const BILLING_PERMISSION_DENIED_MESSAGE =
  "You do not have permission to manage billing for this workspace.";

function responseErrorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload != null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim() !== ""
  ) {
    return payload.error.trim();
  }
  return fallback;
}

export function createBillingJsonRequester({
  credentials,
  fallbackErrorMessage,
  fetch,
}: BillingJsonRequesterOptions) {
  return async function requestBillingJson(
    pathname: string,
    body?: unknown
  ): Promise<unknown> {
    const headers = new Headers(personalResourceAuthHeaders(credentials));
    const init: RequestInit = {
      cache: "no-store",
      headers,
      method: body === undefined ? "GET" : "POST",
    };
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(body);
    }

    const response = await fetch(pathname, init);
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BillingRequestError(
        response.status === 403
          ? BILLING_PERMISSION_DENIED_MESSAGE
          : responseErrorMessage(payload, fallbackErrorMessage),
        response.status,
        payload
      );
    }
    return payload;
  };
}
