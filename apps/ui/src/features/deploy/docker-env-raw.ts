import {
  type ApEnvRawSourceDiagnostic,
  apEnvRawSourceFromRows,
  applyApEnvRawSourceRowPatch,
  parseApEnvRawSource,
  resolveApEnvRawSourceReferences,
} from "@/features/resource-settings/ap/lib/ap-env-raw-source";
import type { DockerDeploymentEnvVar } from "./docker-deployment-settings";

/**
 * Docker deploy env model: the AP Environment Raw Source is canonical and the
 * list view is derived from it (docs/adr context: CONTEXT.md "AP Environment
 * Raw Source"). References are not supported at deploy time — they surface as
 * blocking diagnostics rather than resolving.
 */

export const DOCKER_ENV_REFERENCE_UNSUPPORTED_MESSAGE =
  "References are not supported when deploying. Use a literal value; connect a database from AP Settings after deploy.";

/**
 * One list-view row over the raw source. Unlike the parser's assignment rows,
 * this keeps lines whose name is currently empty or invalid (they still
 * contain a `=`), so a row being edited in the list never vanishes mid-edit.
 */
export interface DockerEnvRowView {
  /** 1-indexed raw source line this row renders. */
  line: number;
  name: string;
  value: string;
}

/** The canonical raw source for settings: stored raw, or serialized rows for legacy snapshots. */
export function dockerEnvCanonicalRawSource({
  env,
  envRawSource,
}: {
  env?: readonly DockerDeploymentEnvVar[];
  envRawSource?: string;
}): string {
  return envRawSource ?? apEnvRawSourceFromRows(env ?? []);
}

export function dockerEnvRowViews(source: string): DockerEnvRowView[] {
  const parsed = parseApEnvRawSource(source);
  const views: DockerEnvRowView[] = [];
  for (const line of parsed.lines) {
    if (line.kind === "assignment") {
      views.push({ line: line.line, name: line.key, value: line.value });
      continue;
    }
    if (line.kind === "invalid") {
      const equalsIndex = line.raw.indexOf("=");
      if (equalsIndex === -1) {
        continue;
      }
      views.push({
        line: line.line,
        name: line.raw.slice(0, equalsIndex).trim(),
        value: line.raw.slice(equalsIndex + 1).trim(),
      });
    }
  }
  return views;
}

export function patchDockerEnvRow(
  source: string,
  line: number,
  patch: Partial<Pick<DockerEnvRowView, "name" | "value">>
): string {
  const parsed = parseApEnvRawSource(source);
  const assignmentIndex = parsed.rows.findIndex((row) => row.line === line);
  if (assignmentIndex !== -1) {
    return applyApEnvRawSourceRowPatch(source, assignmentIndex, patch).source;
  }
  const lines = source.split("\n");
  const raw = lines[line - 1];
  if (raw == null) {
    return source;
  }
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex === -1) {
    return source;
  }
  const name = patch.name ?? raw.slice(0, equalsIndex).trim();
  const value = patch.value ?? raw.slice(equalsIndex + 1).trim();
  lines[line - 1] = `${name}=${value}`;
  return lines.join("\n");
}

export function removeDockerEnvRow(source: string, line: number): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) {
    return source;
  }
  lines.splice(line - 1, 1);
  return lines.join("\n");
}

export function appendDockerEnvRow(source: string, name: string): string {
  const assignment = `${name}=`;
  if (source === "") {
    return assignment;
  }
  return source.endsWith("\n")
    ? `${source}${assignment}`
    : `${source}\n${assignment}`;
}

/** The derived `env` rows persisted alongside the raw source: valid assignments only. */
export function dockerEnvRowsForSave(source: string): DockerDeploymentEnvVar[] {
  return parseApEnvRawSource(source).rows.map((row) => ({
    name: row.key,
    value: row.value,
  }));
}

/**
 * All deploy-blocking diagnostics for one raw source: the parser's own
 * (syntax, names, duplicates) plus every reference expression, which is
 * unsupported at deploy time regardless of what it points at.
 */
export function dockerEnvRawDiagnostics(
  source: string
): ApEnvRawSourceDiagnostic[] {
  const parsed = parseApEnvRawSource(source);
  if (!parsed.valid) {
    return parsed.diagnostics;
  }
  return resolveApEnvRawSourceReferences(source, []).diagnostics.map(
    (diagnostic) =>
      diagnostic.type === "unresolved-reference"
        ? { ...diagnostic, message: DOCKER_ENV_REFERENCE_UNSUPPORTED_MESSAGE }
        : diagnostic
  );
}
