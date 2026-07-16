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
