import type { DevMockCookie } from "../cookie";

export type DevMockResolution<S extends string> =
  | { kind: "invalid"; response: Response }
  | { kind: "off" }
  | { kind: "set"; scenario: S };

/**
 * Reads a Dev Mock's cookie off a request: off (no cookie, or disabled, or a
 * real production build), invalid (a 500 that names the valid scenarios so
 * typos fail loud), or the scenario to serve. Every fixture dispatcher
 * resolves through here; the dynamic-import gate that keeps fixtures out of
 * production bundles stays inlined at each route (a helper call would not
 * be statically dropped), this is the runtime backstop behind it.
 */
export function resolveDevMock<S extends string>(
  cookie: DevMockCookie<S>,
  request: Request,
  label: string
): DevMockResolution<S> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return { kind: "off" };
  }
  const parsed = cookie.parse(cookie.fromRequest(request));
  if (
    parsed.kind === "unset" ||
    (parsed.kind === "set" && !parsed.state.enabled)
  ) {
    return { kind: "off" };
  }
  if (parsed.kind === "invalid") {
    return {
      kind: "invalid",
      response: Response.json(
        {
          error: `Unknown ${label} mock scenario "${parsed.raw}". Valid scenarios: ${cookie.scenarios.join(", ")}. Toggle the mock from the dev tweaks pane (⌃⌥T).`,
        },
        { status: 500 }
      ),
    };
  }
  return { kind: "set", scenario: parsed.state.scenario };
}
