/** Escape regexp special chars for building {@link RegExp} from placeholder keys. */
function escapeRegexKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Substitutes simple YAML templates that use `{{ name }}`, `{{ namespace }}`,
 * `{{ image }}`, etc.
 */
export function renderYamlTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template;
  const entries = Object.entries(vars).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [key, rawVal] of entries) {
    const val = rawVal.trim();
    const re = new RegExp(`\\{\\{\\s*${escapeRegexKey(key)}\\s*\\}\\}`, "g");
    out = out.replace(re, val);
  }
  return out.replace(/\r\n/g, "\n").trimEnd();
}

/** Concatenate manifests for `POST /apply` (`kubectl apply -f`-style multi-document). */
export function joinKubeYamlDocuments(docs: string[]): string {
  return docs
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0)
    .join("\n---\n");
}
