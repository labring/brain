/**
 * The cookie protocol every route-handler Dev Mock speaks, shared by its
 * dev-tweaks registration (client) and its fixture dispatcher (server). A
 * Dev Mock's session cookie is the single source of truth for its state —
 * no env var, no localStorage copy — and each Dev Mock owns one cookie, so
 * independent mocks compose: the billing mock and the Notification Center
 * mock can be on at once, each answering only its own surfaces.
 *
 * Value grammar: `<scenario>` while the mock is on, `off:<scenario>` while it
 * is off (the scenario part keeps the last selection so the panel can
 * restore it). Anything else is invalid and makes the server answer 500 so
 * typos fail loud instead of silently serving real data.
 */

const OFF_PREFIX = "off:";

export interface DevMockState<S extends string> {
  enabled: boolean;
  scenario: S;
}

export type ParsedDevMockCookie<S extends string> =
  | { kind: "invalid"; raw: string }
  | { kind: "set"; state: DevMockState<S> }
  | { kind: "unset" };

export interface DevMockCookieDef<S extends string> {
  defaultScenario: S;
  /** The session cookie's name. */
  name: string;
  scenarios: readonly S[];
}

export interface DevMockCookie<S extends string> extends DevMockCookieDef<S> {
  /** The `document.cookie` assignment the client writes on a toggle. */
  documentCookie(state: DevMockState<S>): string;
  format(state: DevMockState<S>): string;
  /**
   * The raw cookie value off a `Cookie`-header-shaped string, if present.
   * `document.cookie` reads back in exactly this shape, so the client passes
   * it here directly — never through a constructed `Request`, whose `Cookie`
   * header a browser silently drops (forbidden request header).
   */
  fromCookieHeader(header: string | null): string | undefined;
  /** The raw cookie value off a request's `cookie` header, if present. */
  fromRequest(request: Request): string | undefined;
  is(value: string): value is S;
  parse(raw: string | null | undefined): ParsedDevMockCookie<S>;
  /** The cookie the server sends when it advances the scenario itself. */
  setCookieHeader(state: DevMockState<S>): string;
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      const raw = pair.slice(separator + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        // A malformed %-sequence (some other cookie's doing) must surface as
        // an invalid value, not throw out of every load().
        return raw;
      }
    }
  }
  return undefined;
}

export function defineDevMockCookie<S extends string>(
  def: DevMockCookieDef<S>
): DevMockCookie<S> {
  const is = (value: string): value is S =>
    (def.scenarios as readonly string[]).includes(value);
  const format = (state: DevMockState<S>): string =>
    state.enabled ? state.scenario : `${OFF_PREFIX}${state.scenario}`;
  return {
    ...def,
    documentCookie: (state) =>
      `${def.name}=${format(state)}; path=/; samesite=lax`,
    format,
    fromCookieHeader: (header) => cookieValue(header, def.name),
    fromRequest: (request) =>
      cookieValue(request.headers.get("cookie"), def.name),
    is,
    parse: (raw) => {
      const value = raw?.trim() ?? "";
      if (value === "") {
        return { kind: "unset" };
      }
      if (value.startsWith(OFF_PREFIX)) {
        const scenario = value.slice(OFF_PREFIX.length);
        return {
          kind: "set",
          state: {
            enabled: false,
            scenario: is(scenario) ? scenario : def.defaultScenario,
          },
        };
      }
      if (is(value)) {
        return { kind: "set", state: { enabled: true, scenario: value } };
      }
      return { kind: "invalid", raw: value };
    },
    setCookieHeader: (state) =>
      `${def.name}=${format(state)}; Path=/; SameSite=Lax`,
  };
}
