/**
 * How long an explicitly revealed secret value stays on screen before
 * auto-hiding again. Shared by the AP Environment editor and the DB Settings
 * connection panel so every reveal surface behaves the same (ADR-0052).
 */
export const SETTINGS_REVEAL_DURATION_MS = 30_000;

export async function writeTextToClipboard(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard permissions are best-effort UI affordances.
  }
}

/**
 * Copies a secret-bearing value that page state only holds as a credential-free
 * placeholder (e.g. a DB Connection Template, ADR-0052): when a resolver is
 * available the complete value is fetched on demand and copied; without one the
 * placeholder is copied instead — the most useful value a resolver-less surface
 * can offer, even though the row itself renders a mask (ADR-0054). A failed
 * resolve rejects so callers surface the error rather than silently copying a
 * value that will not work.
 */
export async function copyResolvedSecretValue({
  placeholderValue,
  resolveAvailable,
  resolveValue,
}: {
  placeholderValue: string;
  resolveAvailable: boolean;
  resolveValue: () => Promise<string>;
}): Promise<void> {
  if (!resolveAvailable) {
    if (placeholderValue !== "") {
      await writeTextToClipboard(placeholderValue);
    }
    return;
  }
  const value = await resolveValue();
  if (value !== "") {
    await writeTextToClipboard(value);
  }
}
