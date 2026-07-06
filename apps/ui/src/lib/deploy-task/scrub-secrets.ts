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

export function artifactSummaryWithScrubbedYamls(
  summary: DeployTaskArtifactSummary,
  values: readonly string[]
): DeployTaskArtifactSummary {
  const yamls = summary.resourceYamls;
  if (yamls == null || yamls.length === 0 || values.length === 0) {
    return summary;
  }
  return {
    ...summary,
    resourceYamls: yamls.map((yaml) => scrubSensitiveText(yaml, values)),
  };
}
