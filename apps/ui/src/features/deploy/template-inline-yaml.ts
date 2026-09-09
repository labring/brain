/**
 * Splits a Sealos inline template into its leading Template document and
 * the resource source that follows. The inline form is a DSL, not standalone
 * YAML: resource documents may carry top-level `if`/`endif` directives, so
 * only the header is YAML before expression rendering; the rest is kept
 * byte-for-byte for the renderer.
 */
export function templateHeaderFromInlineYaml(yaml: string): {
  headerYaml: string;
  resourceSourceOffset: number;
} {
  const marker = /^---[\t ]*(?:#.*)?\r?$/gm;
  const firstMarker = marker.exec(yaml);
  if (firstMarker == null) {
    return { headerYaml: yaml, resourceSourceOffset: yaml.length };
  }
  const resourceMarker =
    yaml.slice(0, firstMarker.index).trim() === ""
      ? marker.exec(yaml)
      : firstMarker;
  if (resourceMarker == null) {
    return { headerYaml: yaml, resourceSourceOffset: yaml.length };
  }
  const resourceSourceOffset =
    resourceMarker.index +
    resourceMarker[0].length +
    (yaml[resourceMarker.index + resourceMarker[0].length] === "\n" ? 1 : 0);
  return {
    headerYaml: yaml.slice(0, resourceMarker.index),
    resourceSourceOffset,
  };
}
