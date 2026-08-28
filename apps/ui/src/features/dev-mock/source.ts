"use client";

import type { DevTweaksMockSource } from "@workspace/dev-tweaks";

import type { DevMockCookie } from "./cookie";

/**
 * The dev-tweaks panel's remote control for a cookie-backed Dev Mock. The
 * panel never owns the state: `load` re-reads the cookie, `set` writes it
 * and then asks the feature to revalidate the SWR keys its fixtures shape,
 * `watch` picks up rewrites the server makes behind the panel's back (a
 * fixture's `Set-Cookie` scenario transition) — the Cookie Store API pushes
 * those, the focus/interval pair is the fallback.
 */
export function createDevMockCookieSource<S extends string>(
  cookie: DevMockCookie<S>,
  options: { revalidate: () => void }
): DevTweaksMockSource {
  return {
    load: () => {
      const parsed = cookie.parse(
        cookie.fromRequest(
          new Request("http://mock.local", {
            headers: { cookie: document.cookie },
          })
        )
      );
      return parsed.kind === "set" ? parsed.state : null;
    },
    set: (state) => {
      const scenario = cookie.is(state.scenario)
        ? state.scenario
        : cookie.defaultScenario;
      // biome-ignore lint/suspicious/noDocumentCookie: the synchronous write must land before the SWR refetches fire; the async Cookie Store API cannot guarantee that.
      document.cookie = cookie.documentCookie({
        enabled: state.enabled,
        scenario,
      });
      options.revalidate();
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
