/**
 * Shared sensitivity predicate for deterministic direct/template deployment
 * paths and UI masking. AI-generated Template content has its own contract:
 * it is persisted without calling these value-scrubbing helpers.
 */
export interface SensitiveDeploymentInputShape {
  key: string;
  sensitive?: boolean;
  type?: string;
}

export const MIN_SENSITIVE_INPUT_LENGTH = 4;

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
 * Args safe to persist: drops explicitly declared fields plus name-heuristic
 * matches. Callers that handle AI-generated Template DSL must not use this
 * helper: generated output is public deployment configuration and is retained
 * unchanged.
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
 * Values of sensitive args that are safe to use for substring scrubbing.
 * Empty and very short values are excluded: replacing a 1–3 character
 * substring everywhere would mangle unrelated text. Callers that accept
 * sensitive input must reject those short values before persistence.
 */
export function sensitiveArgValues(
  args: Record<string, string> | undefined,
  inputs?: readonly SensitiveDeploymentInputShape[]
): string[] {
  return allSensitiveArgValues(args, inputs).filter(
    (value) => value.length >= MIN_SENSITIVE_INPUT_LENGTH
  );
}

export function allSensitiveArgValues(
  args: Record<string, string> | undefined,
  inputs?: readonly SensitiveDeploymentInputShape[]
): string[] {
  const declared = sensitiveDeploymentInputKeys(inputs);
  return Object.entries(args ?? {})
    .filter(([key]) => declared.has(key) || isSensitiveDeploymentInput({ key }))
    .map(([, value]) => value)
    .filter((value) => value.length > 0);
}

export function shortSensitiveArgKeys(
  args: Record<string, string> | undefined,
  inputs?: readonly SensitiveDeploymentInputShape[]
): string[] {
  const declared = sensitiveDeploymentInputKeys(inputs);
  return Object.entries(args ?? {}).flatMap(([key, value]) =>
    (declared.has(key) || isSensitiveDeploymentInput({ key })) &&
    value.length > 0 &&
    value.length < MIN_SENSITIVE_INPUT_LENGTH
      ? [key]
      : []
  );
}
