export type ChildResourceKind = "ap" | "db";

function randomSixDigits(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}

/** Child resource name: `{kind}-{6 random digits}` (DNS-1035 label). */
export function childResourceName(
  _projectName: string,
  kind: ChildResourceKind = "ap"
): string {
  return `${kind}-${randomSixDigits()}`;
}
