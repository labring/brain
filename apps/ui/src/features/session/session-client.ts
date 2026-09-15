import {
  type BrainSession,
  brainSessionSchema,
  sessionErrorSchema,
} from "./session-schema";

/**
 * The page's side of `POST /api/session` (spec §A.5, §A.8): one call, one
 * validated answer. `unauthorized` is the 401 the overlay reacts to; every
 * other failure carries the route's error code so the caller can show the
 * generic session error without reading Desktop text.
 */

export const SESSION_API_PATH = "/api/session";

export type FetchBrainSessionResult =
  | { kind: "ok"; session: BrainSession }
  | { kind: "unauthorized" }
  | { code: string; kind: "failed"; status: number }
  | { kind: "network" };

export type SessionFetch = (
  input: string,
  init: RequestInit
) => Promise<Response>;

export async function fetchBrainSession(
  input: { nsid: string | null },
  fetchImpl: SessionFetch = (url, init) => fetch(url, init)
): Promise<FetchBrainSessionResult> {
  const nsid = input.nsid?.trim() ?? "";
  let response: Response;
  try {
    response = await fetchImpl(SESSION_API_PATH, {
      body: JSON.stringify(nsid === "" ? {} : { nsid }),
      // The shared login cookie rides along on this same-origin request.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    return { kind: "network" };
  }
  if (response.status === 401) {
    await response.body?.cancel();
    return { kind: "unauthorized" };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = sessionErrorSchema.safeParse(payload);
    return {
      code: parsed.success ? parsed.data.error : "unknown",
      kind: "failed",
      status: response.status,
    };
  }
  const parsed = brainSessionSchema.safeParse(payload);
  return parsed.success
    ? { kind: "ok", session: parsed.data }
    : { code: "malformed_session", kind: "failed", status: response.status };
}
