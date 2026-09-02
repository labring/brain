"use client";

import type { DevTweaksMockSource } from "@workspace/dev-tweaks";

import type { DevMockCookie } from "./cookie";

/**
 * The dev-tweaks panel's remote control for a cookie-backed Dev Mock. The
 * panel never owns the state: `load` re-reads the cookie, `set` writes it,
 * `watch` picks up rewrites the server makes behind the panel's back (a
 * fixture's `Set-Cookie` scenario transition) — the Cookie Store API pushes
 * those, the focus/interval pair is the fallback. Revalidation is not this
 * source's job: the mock store calls the def's `revalidate` whenever the
 * adopted state changes what the mock serves, whichever side changed it.
 *
 * `load` parses `document.cookie` directly. It must never round-trip through
 * a constructed `Request`: `Cookie` is a forbidden request header, so a
 * browser drops it silently and the panel would forever read "unset" — a
 * failure no Node/happy-dom test can reproduce, which is exactly how it
 * once shipped.
 */
export function createDevMockCookieSource<S extends string>(
  cookie: DevMockCookie<S>
): DevTweaksMockSource {
  return {
    load: () => {
      const parsed = cookie.parse(cookie.fromCookieHeader(document.cookie));
      return parsed.kind === "set" ? parsed.state : null;
    },
    set: (state) => {
      const scenario = cookie.is(state.scenario)
        ? state.scenario
        : cookie.defaultScenario;
      // biome-ignore lint/suspicious/noDocumentCookie: the synchronous write must land before the revalidation refetches fire; the async Cookie Store API cannot guarantee that.
      document.cookie = cookie.documentCookie({
        enabled: state.enabled,
        scenario,
      });
    },
    watch: (onChange) => {
      const cookieStore = (window as { cookieStore?: EventTarget }).cookieStore;
      cookieStore?.addEventListener("change", onChange);
      window.addEventListener("focus", onChange);
      const watchTimer =
        cookieStore == null ? window.setInterval(onChange, 3000) : undefined;
      return () => {
        cookieStore?.removeEventListener("change", onChange);
        window.removeEventListener("focus", onChange);
        if (watchTimer != null) {
          window.clearInterval(watchTimer);
        }
      };
    },
  };
}
