import { SignJWT } from "jose";

import type { AccountServiceConfig } from "./config-core";

const ACCOUNT_SERVICE_TOKEN_TTL_SECONDS = 5 * 60;

export interface AccountServiceActor {
  userId: string;
  userUid: string;
}

export interface AccountServiceActorBinding {
  userId: string | null;
  userUid: string;
}

export interface AccountServiceRequest {
  actor: AccountServiceActorBinding;
  init?: RequestInit;
  pathname: string;
}

export type AccountServiceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface AccountServiceClientDependencies {
  config: AccountServiceConfig;
  fetch?: AccountServiceFetch;
  nowSeconds?: () => number;
}

export type AccountServiceClient = (
  request: AccountServiceRequest
) => Promise<Response>;

function accountServiceActorFromBinding(
  binding: AccountServiceActorBinding
): AccountServiceActor | null {
  const userId = binding.userId?.trim() ?? "";
  const userUid = binding.userUid.trim();
  return userId === "" || userUid === "" ? null : { userId, userUid };
}

function requestUrl(baseUrl: string, pathname: string): string {
  const normalizedPathname = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;
  return `${baseUrl}${normalizedPathname}`;
}

async function signActorToken(
  actor: AccountServiceActor,
  signingSecret: string,
  nowSeconds: number
): Promise<string> {
  return await new SignJWT({
    userId: actor.userId,
    userUid: actor.userUid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ACCOUNT_SERVICE_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(signingSecret));
}

function upstreamErrorMessage(payload: unknown): string {
  if (typeof payload === "string" && payload.trim() !== "") {
    return payload.trim();
  }
  if (typeof payload !== "object" || payload == null) {
    return "Account service request failed.";
  }
  if (
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim() !== ""
  ) {
    return payload.error.trim();
  }
  if (
    "message" in payload &&
    typeof payload.message === "string" &&
    payload.message.trim() !== ""
  ) {
    return payload.message.trim();
  }
  return "Account service request failed.";
}

async function mapAccountServiceResponse(
  response: Response
): Promise<Response> {
  if (response.ok) {
    return response;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return Response.json(
    { error: upstreamErrorMessage(payload) },
    { status: response.status }
  );
}

export function createAccountServiceClient(
  dependencies: AccountServiceClientDependencies
): AccountServiceClient {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const nowSeconds =
    dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async ({ actor, init, pathname }) => {
    const verifiedActor = accountServiceActorFromBinding(actor);
    if (verifiedActor == null) {
      throw new Error(
        "Account service calls require verified userId and userUid claims."
      );
    }
    const token = await signActorToken(
      verifiedActor,
      dependencies.config.signingSecret,
      nowSeconds()
    );
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(
        requestUrl(dependencies.config.baseUrl, pathname),
        {
          ...init,
          cache: "no-store",
          headers,
        }
      );
    } catch {
      return Response.json(
        { error: "Account service is unavailable." },
        { status: 502 }
      );
    }
    return await mapAccountServiceResponse(response);
  };
}
