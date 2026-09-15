/**
 * Reads one cookie's value off a `Cookie`-header-shaped string (a request's
 * `cookie` header, or `document.cookie`, which reads back in the same
 * shape). Shared by every server-side cookie reader so the parsing — and
 * its tolerance of another cookie's malformed %-sequence — lives once.
 */
export function cookieValueFromHeader(
  header: string | null | undefined,
  name: string
): string | undefined {
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
        // the raw value, not throw out of every reader.
        return raw;
      }
    }
  }
  return undefined;
}
