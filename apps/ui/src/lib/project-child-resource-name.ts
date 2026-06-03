import { randomNano } from "@workspace/ui/lib/generator";

export type ChildResourceKind = "ap" | "db";

function dns1035Segment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "resource"
  );
}

/** Child resource name: `{kind}-{projectIdSegment}-{randomNano}` (≤63 chars, DNS-1035 label). */
export function childResourceName(
  projectName: string,
  kind: ChildResourceKind = "ap"
): string {
  const nano = randomNano();
  const max = 63;
  const sep = "-";
  const tail = `${sep}${nano}`;
  const prefix = `${kind}${sep}`;
  const cap = max - prefix.length - tail.length;
  const normalizedProject = dns1035Segment(projectName);
  const base =
    normalizedProject.length <= cap
      ? normalizedProject
      : normalizedProject.slice(0, cap).replace(/-+$/g, "");
  return `${prefix}${base}${tail}`;
}
