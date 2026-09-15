import "server-only";

import type { z } from "zod";

/**
 * The Desktop HTTP boundary (ADR-0083, spec §B.3): one place that calls a
 * Desktop route and unpacks its envelope. Desktop answers HTTP 200 for
 * everything and puts the business code in `body.code`; this client turns
 * that into a discriminated result the route handlers translate into real
 * HTTP statuses. `fetch` is injectable — the test seam — and every call
 * carries a timeout so a stuck Desktop cannot hang a Brain request.
 *
 * Authorization forms differ per token and are the caller's business
 * (`authorization` is passed verbatim): the global and regional tokens go
 * URL-encoded without a scheme, the app token goes raw.
 */

export const DESKTOP_REQUEST_TIMEOUT_MS = 30_000;

export type DesktopFetch = (input: URL, init: RequestInit) => Promise<Response>;

export type DesktopCallFailure =
  /** Desktop answered with a non-200 business code. */
  | { code: number; kind: "desktop_code"; message: string }
  /** Desktop answered, but not with a well-formed envelope or data shape. */
  | { kind: "malformed" }
  /** Desktop answered with a non-2xx HTTP status (an ingress or 404 page). */
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "unreachable" };

export type DesktopCallResult<T> =
  | { data: T; ok: true }
  | ({ ok: false } & DesktopCallFailure);

export interface DesktopCallInput<T> {
  authorization: string;
  body?: unknown;
  dataSchema: z.ZodType<T>;
  method: "GET" | "POST";
  /** Desktop route path, e.g. `/api/auth/regionToken`. */
  path: string;
}

export interface DesktopClient {
  call<T>(input: DesktopCallInput<T>): Promise<DesktopCallResult<T>>;
}

const TRAILING_SLASHES_RE = /\/+$/;

/** `DESKTOP_API_BASE_URL`, trailing slashes dropped; null when unset. */
export function desktopApiBaseUrlFromEnv(
  env: Record<string, string | undefined> = process.env
): string | null {
  const raw = env.DESKTOP_API_BASE_URL?.trim() ?? "";
  if (raw === "") {
    return null;
  }
  return raw.replace(TRAILING_SLASHES_RE, "");
}

/** Global and regional tokens travel URL-encoded with no auth scheme. */
export function encodedTokenAuthorization(token: string): string {
  return encodeURIComponent(token);
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function envelopeOf(
  payload: unknown
): { code: number; data: unknown; message: string } | null {
  if (
    typeof payload !== "object" ||
    payload == null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.code !== "number") {
    return null;
  }
  return {
    code: record.code,
    data: record.data,
    message: typeof record.message === "string" ? record.message : "",
  };
}

export function createDesktopClient(options: {
  baseUrl: string;
  fetch?: DesktopFetch;
  timeoutMs?: number;
}): DesktopClient {
  const fetchDesktop: DesktopFetch =
    options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DESKTOP_REQUEST_TIMEOUT_MS;
  const baseUrl = options.baseUrl.replace(TRAILING_SLASHES_RE, "");

  return {
    async call<T>(input: DesktopCallInput<T>): Promise<DesktopCallResult<T>> {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: input.authorization,
      };
      const init: RequestInit = {
        headers,
        method: input.method,
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (input.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(input.body);
      }

      let response: Response;
      try {
        response = await fetchDesktop(new URL(`${baseUrl}${input.path}`), init);
      } catch (error) {
        return isTimeout(error)
          ? { kind: "timeout", ok: false }
          : { kind: "unreachable", ok: false };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { kind: "http", ok: false, status: response.status };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: "malformed", ok: false };
      }
      const envelope = envelopeOf(payload);
      if (envelope == null) {
        return { kind: "malformed", ok: false };
      }
      if (envelope.code !== 200) {
        return {
          code: envelope.code,
          kind: "desktop_code",
          message: envelope.message,
          ok: false,
        };
      }
      const parsed = input.dataSchema.safeParse(envelope.data);
      return parsed.success
        ? { data: parsed.data, ok: true }
        : { kind: "malformed", ok: false };
    },
  };
}
