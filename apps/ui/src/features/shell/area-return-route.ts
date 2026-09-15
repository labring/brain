/**
 * The return address of a product area (the Billing Area, the Workspace
 * Area): the in-app route the user entered the area from, recorded on the
 * links that lead in and read by the area's close button. Parameterized by
 * the area's URL prefix: a path inside the area never qualifies as its own
 * return address, and anything that is not an internal path (deep-link
 * entry, cleared storage, tampered value) falls back to home.
 */
export interface AreaReturnRoute {
  /** Forgets the recorded route; close then falls back to home. */
  clear(): void;
  /** The recorded route, sanitized; "/" when nothing usable is recorded. */
  read(): string;
  /** Records the current route unless it already lies inside the area. */
  record(): void;
  sanitize(raw: string | null): string;
}

export function createAreaReturnRoute(area: {
  prefix: string;
  storageKey: string;
}): AreaReturnRoute {
  const sanitize = (raw: string | null): string => {
    if (
      raw?.startsWith("/") &&
      !raw.startsWith("//") &&
      !raw.startsWith(area.prefix)
    ) {
      return raw;
    }
    return "/";
  };
  return {
    clear() {
      if (typeof window === "undefined") {
        return;
      }
      try {
        window.sessionStorage.removeItem(area.storageKey);
      } catch {
        // Nothing stored where storage is unavailable; see `record`.
      }
    },
    read() {
      if (typeof window === "undefined") {
        return "/";
      }
      try {
        return sanitize(window.sessionStorage.getItem(area.storageKey));
      } catch {
        return "/";
      }
    },
    record() {
      if (typeof window === "undefined") {
        return;
      }
      const route = `${window.location.pathname}${window.location.search}`;
      if (route.startsWith(area.prefix)) {
        return;
      }
      try {
        window.sessionStorage.setItem(area.storageKey, route);
      } catch {
        // Storage can be unavailable (private browsing); close falls back to home.
      }
    },
    sanitize,
  };
}
