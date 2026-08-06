import { posix as path } from "node:path";
import { z } from "zod";

export const MANAGED_INPUT_VALUES_MAX_BYTES = 64 * 1024;

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
const DNS_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;

const namespaceSchema = z.string().min(1).max(63).regex(DNS_LABEL_PATTERN);
const resourceNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(DNS_SUBDOMAIN_PATTERN);

export const managedResourceRefSchema = z
  .object({
    apiVersion: z.string().trim().min(1).max(128),
    kind: z.string().trim().min(1).max(128),
    name: resourceNameSchema,
    namespace: namespaceSchema,
    uid: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type ManagedResourceRef = z.infer<typeof managedResourceRefSchema>;

function assertSafeAbsolutePath(value: string, label: string): void {
  if (
    !value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    path.normalize(value) !== value
  ) {
    throw new Error(`${label} must be a normalized absolute path.`);
  }
}

function normalizedSafeRoot(root: string): string | null {
  if (
    !root.startsWith("/") ||
    root.includes("\0") ||
    root.includes("\n") ||
    root.includes("\r") ||
    path.normalize(root) !== root ||
    root === "/"
  ) {
    return null;
  }
  return root;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Writes a bounded payload into the Devbox from stdin without embedding the
 * values in the command line. Used for the fixed task input file the Agent
 * resumes from after Brain renders the Template form.
 */
export function buildAtomicStdinWriteCommand(input: {
  allowedRoot: string;
  maxBytes: number;
  mode?: "0600" | "0644";
  path: string;
}): string {
  assertSafeAbsolutePath(input.path, "Atomic stdin target");
  const allowedRoot = normalizedSafeRoot(input.allowedRoot);
  if (allowedRoot == null || !input.path.startsWith(`${allowedRoot}/`)) {
    throw new Error("Atomic stdin target must be inside its allowed root.");
  }
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new Error("Atomic stdin byte limit must be a positive integer.");
  }
  return [
    "set -euo pipefail",
    "umask 077",
    `target=${shellQuote(input.path)}`,
    'target_dir="$(dirname "$target")"',
    'mkdir -p "$target_dir"',
    'chmod 0700 "$target_dir"',
    'tmp="$(mktemp "$target_dir/.sealai-contract.XXXXXX")"',
    'cleanup() { rm -f "$tmp"; }',
    "trap cleanup EXIT",
    'cat > "$tmp"',
    `test "$(wc -c < "$tmp")" -le ${input.maxBytes}`,
    `chmod ${input.mode ?? "0600"} "$tmp"`,
    'mv -f "$tmp" "$target"',
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown devbox:devbox "$target_dir" "$target"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown devbox:devbox "$target_dir" "$target"',
    "  fi",
    "fi",
    "trap - EXIT",
  ].join("\n");
}
