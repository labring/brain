export const PORT_NUMBER_DIGITS_RE = /^\d+$/;

export function parsePortNumberDigits(
  trimmed: string
): { ok: false; message: string } | { n: number; ok: true } {
  if (trimmed === "") {
    return { ok: false, message: "Enter a port number." };
  }
  if (!PORT_NUMBER_DIGITS_RE.test(trimmed)) {
    return {
      ok: false,
      message: "Use a whole number between 1 and 65535.",
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n < 1 || n > 65_535) {
    return { ok: false, message: "Port must be between 1 and 65535." };
  }
  return { ok: true, n };
}
