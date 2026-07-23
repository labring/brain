import "server-only";

import { getDevboxExecRequestTimeoutMs } from "./client-core";
import {
  getDevboxApiPrefix,
  getDevboxAuthToken,
  getDevboxBaseUrl,
} from "./config";
import type {
  CreateDevboxInput,
  CreateDevboxResult,
  DeleteDevboxResult,
  DevboxEnvelope,
  DevboxExecInput,
  DevboxExecResult,
  DevboxHealthData,
  DevboxInfo,
  DevboxListItem,
  PauseDevboxResult,
  RefreshPauseInput,
  RefreshPauseResult,
} from "./types";

const DEVBOX_REQUEST_TIMEOUT_MS = 60_000;
const DEVBOX_NETWORK_RETRY_DELAYS_MS = [500, 1500, 3000];

export class DevboxApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DevboxApiError";
    this.status = status;
  }
}

function buildUrl(
  pathname: string,
  searchParams?: URLSearchParams,
  includeApiPrefix = true
): string {
  const basePath = includeApiPrefix
    ? `${getDevboxApiPrefix()}${pathname}`
    : pathname;
  const url = new URL(basePath, getDevboxBaseUrl());
  if (searchParams != null) {
    url.search = searchParams.toString();
  }
  return url.toString();
}

async function parseJsonResponse<T>(
  response: Response
): Promise<DevboxEnvelope<T>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DevboxApiError(
      response.status,
      "Devbox API returned an invalid JSON response"
    );
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload != null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Devbox API request failed";

    throw new DevboxApiError(response.status, message);
  }

  return payload as DevboxEnvelope<T>;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof DevboxApiError) {
    return false;
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const cause = error.cause;
  const causeCode =
    typeof cause === "object" &&
    cause != null &&
    "code" in cause &&
    typeof cause.code === "string"
      ? cause.code
      : null;

  return (
    error.message === "fetch failed" ||
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT"
  );
}

async function devboxRequest<T>(
  pathname: string,
  init?: Omit<RequestInit, "headers"> & {
    authNamespace?: string;
    headers?: HeadersInit;
    skipAuth?: boolean;
    searchParams?: URLSearchParams;
    includeApiPrefix?: boolean;
    timeoutMs?: number;
  }
): Promise<DevboxEnvelope<T>> {
  const {
    authNamespace,
    headers: initHeaders,
    includeApiPrefix,
    searchParams,
    skipAuth,
    timeoutMs,
    ...requestInit
  } = init ?? {};

  for (
    let attempt = 0;
    attempt <= DEVBOX_NETWORK_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    requestInit.signal?.throwIfAborted();
    const headers = new Headers(initHeaders);

    if (!skipAuth) {
      if (authNamespace == null || authNamespace.trim() === "") {
        throw new Error("Devbox auth namespace is required.");
      }
      const token = await getDevboxAuthToken(authNamespace);
      requestInit.signal?.throwIfAborted();
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (requestInit.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const timeoutSignal = AbortSignal.timeout(
      timeoutMs ?? DEVBOX_REQUEST_TIMEOUT_MS
    );
    const signal = requestInit.signal
      ? AbortSignal.any([requestInit.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetch(
        buildUrl(pathname, searchParams, includeApiPrefix),
        {
          ...requestInit,
          cache: "no-store",
          headers,
          signal,
        }
      );

      return await parseJsonResponse<T>(response);
    } catch (error) {
      requestInit.signal?.throwIfAborted();
      const retryDelay = DEVBOX_NETWORK_RETRY_DELAYS_MS[attempt];
      if (!isRetryableNetworkError(error) || retryDelay === undefined) {
        throw error;
      }

      console.warn(
        `Devbox request failed with retryable network error; retrying in ${retryDelay}ms`,
        error
      );
      await sleep(retryDelay, requestInit.signal);
    }
  }

  throw new Error("Devbox request failed after retries");
}

export async function getDevboxHealth() {
  return await devboxRequest<DevboxHealthData>("/healthz", {
    includeApiPrefix: false,
    method: "GET",
    skipAuth: true,
  });
}

export async function createDevbox(
  authNamespace: string,
  input: CreateDevboxInput,
  signal?: AbortSignal
) {
  return await devboxRequest<CreateDevboxResult>("", {
    authNamespace,
    body: JSON.stringify(input),
    method: "POST",
    signal,
  });
}

export async function listDevboxes(
  authNamespace: string,
  upstreamID?: string,
  signal?: AbortSignal
) {
  const searchParams = new URLSearchParams();
  if (upstreamID != null && upstreamID !== "") {
    searchParams.set("upstreamID", upstreamID);
  }

  return await devboxRequest<{ items: DevboxListItem[] }>("", {
    authNamespace,
    method: "GET",
    searchParams,
    signal,
  });
}

export async function getDevbox(
  authNamespace: string,
  name: string,
  signal?: AbortSignal
) {
  return await devboxRequest<DevboxInfo>(`/${encodeURIComponent(name)}`, {
    authNamespace,
    method: "GET",
    signal,
  });
}

export async function pauseDevbox(authNamespace: string, name: string) {
  return await devboxRequest<PauseDevboxResult>(
    `/${encodeURIComponent(name)}/pause`,
    { authNamespace, method: "POST" }
  );
}

export async function refreshDevboxPause(
  authNamespace: string,
  name: string,
  input: RefreshPauseInput,
  signal?: AbortSignal
) {
  return await devboxRequest<RefreshPauseResult>(
    `/${encodeURIComponent(name)}/pause/refresh`,
    {
      authNamespace,
      body: JSON.stringify(input),
      method: "POST",
      signal,
    }
  );
}

export async function resumeDevbox(
  authNamespace: string,
  name: string,
  signal?: AbortSignal
) {
  return await devboxRequest<PauseDevboxResult>(
    `/${encodeURIComponent(name)}/resume`,
    { authNamespace, method: "POST", signal }
  );
}

export async function deleteDevbox(authNamespace: string, name: string) {
  return await devboxRequest<DeleteDevboxResult>(
    `/${encodeURIComponent(name)}`,
    { authNamespace, method: "DELETE" }
  );
}

export async function execDevbox(
  authNamespace: string,
  name: string,
  input: DevboxExecInput,
  signal?: AbortSignal
) {
  const timeoutMs = getDevboxExecRequestTimeoutMs(input.timeoutSeconds);

  return await devboxRequest<DevboxExecResult>(
    `/${encodeURIComponent(name)}/exec`,
    {
      authNamespace,
      body: JSON.stringify(input),
      method: "POST",
      signal,
      timeoutMs,
    }
  );
}
