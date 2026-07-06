/**
 * The one sensitivity predicate for deployment inputs (ADR 0037 row-level
 * secrets contract). Persist-side stripping (runner), public-DTO redaction,
 * and blocking-form generation must agree on what counts as sensitive, so
 * all of them import it from here. Pure module: safe in client bundles.
 */
export interface SensitiveDeploymentInputShape {
  key: string;
  sensitive?: boolean;
  type?: string;
}

export function isSensitiveDeploymentInput(
  input: SensitiveDeploymentInputShape
): boolean {
  if (input.sensitive === true) {
    return true;
  }
  const type = input.type?.trim().toLowerCase();
  const key = input.key.toLowerCase();
  return (
    type === "password" ||
    type === "secret" ||
    key.includes("secret") ||
    key.includes("password") ||
    key.endsWith("_key") ||
    key.endsWith("_token")
  );
}

export function sensitiveDeploymentInputKeys(
  inputs: readonly SensitiveDeploymentInputShape[] | undefined
): Set<string> {
  return new Set(
    (inputs ?? []).filter(isSensitiveDeploymentInput).map((input) => input.key)
  );
}

/**
 * Args safe to persist: drops keys declared sensitive by the given inputs
 * plus any key the name heuristic flags (covers args for inputs hidden by
 * template conditions or absent declarations).
 */
export function withoutSensitiveArgs(
  args: Record<string, string> | undefined,
  inputs?: readonly SensitiveDeploymentInputShape[]
): Record<string, string> {
  const declared = sensitiveDeploymentInputKeys(inputs);
  return Object.fromEntries(
    Object.entries(args ?? {}).filter(
      ([key]) => !(declared.has(key) || isSensitiveDeploymentInput({ key }))
    )
  );
}

/**
 * Values of sensitive args, for scrubbing persisted rendered output. Empty
 * and very short values are excluded: replacing a 1–3 character substring
 * everywhere would mangle unrelated text.
 */
export function sensitiveArgValues(
  args: Record<string, string> | undefined,
  inputs?: readonly SensitiveDeploymentInputShape[]
): string[] {
  const declared = sensitiveDeploymentInputKeys(inputs);
  return Object.entries(args ?? {})
    .filter(([key]) => declared.has(key) || isSensitiveDeploymentInput({ key }))
    .map(([, value]) => value)
    .filter((value) => value.length >= 4);
}
