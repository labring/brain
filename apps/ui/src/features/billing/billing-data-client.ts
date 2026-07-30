import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

export type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

interface BillingJsonRequesterOptions {
  credentials: { appToken: string; kubeconfig: string };
  fallbackErrorMessage: string;
  fetch: BillingFetch;
}

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
      throw new Error(responseErrorMessage(payload, fallbackErrorMessage));
    }
    return payload;
  };
}
