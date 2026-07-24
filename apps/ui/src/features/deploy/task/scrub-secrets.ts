import type { DeployTaskArtifactSummary } from "./schema";

/**
 * Scrubs known sensitive values out of text that is about to be persisted
 * (ADR 0037 row-level secrets contract). Rendered resource YAML embeds
 * submitted arg values — plain in env vars and annotations, base64 inside
 * Secret manifests — so both encodings of every value are replaced. The
 * scrubbed copy is display-only; the apply path always uses the original.
 */
export const SCRUBBED_VALUE_PLACEHOLDER = "[redacted]";

export function scrubSensitiveText(
  text: string,
  values: readonly string[]
): string {
  let scrubbed = text;
  for (const value of values) {
    if (value.length === 0) {
      continue;
    }
    scrubbed = scrubbed.split(value).join(SCRUBBED_VALUE_PLACEHOLDER);
    const encoded = Buffer.from(value, "utf8").toString("base64");
    scrubbed = scrubbed.split(encoded).join(SCRUBBED_VALUE_PLACEHOLDER);
  }
  return scrubbed;
}

/**
 * Scrubs known sensitive values from an arbitrary JSON-serializable value:
 * raw, JSON-escaped, and base64 occurrences inside any nested string. The
 * scrubbed copy is display-only; callers keep the original in memory for
 * the apply itself.
 */
export function scrubSensitiveJsonValue<T>(
  value: T,
  values: readonly string[]
): T {
  if (values.length === 0) {
    return value;
  }
  const escapedForms = values.flatMap((item) => {
    const jsonForm = JSON.stringify(item).slice(1, -1);
    return jsonForm === item ? [] : [jsonForm];
  });
  const scrubValues = [...values, ...escapedForms];

  function scrubNested(item: unknown): unknown {
    if (typeof item === "string") {
      return scrubSensitiveText(item, scrubValues);
    }
    if (Array.isArray(item)) {
      return item.map(scrubNested);
    }
    if (item != null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([key, nested]) => [
          scrubSensitiveText(key, scrubValues),
          scrubNested(nested),
        ])
      );
    }
    return item;
  }

  return scrubNested(value) as T;
}

export function artifactSummaryWithScrubbedValues(
  summary: DeployTaskArtifactSummary,
  values: readonly string[]
): DeployTaskArtifactSummary {
  if (values.length === 0) {
    return summary;
  }
  return scrubSensitiveJsonValue(summary, values);
}
