import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectMainSurfaceFocusPolicy,
  ProjectSideSurfaceEntry,
  ProjectSurfaceState,
} from "./surface-state";
import {
  type ProjectApBoundEntryPointTarget,
  type ProjectApTarget,
  type ProjectDbTarget,
  type ProjectResourceTarget,
  parseProjectTarget,
  serializeProjectTarget,
} from "./target-identity";

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded === "" ? null : decoded;
  } catch {
    return null;
  }
}

function split(value: string | null | undefined): string[] | null {
  const parts = value?.split(":") ?? null;
  return parts?.every((part) => part !== "") ? parts : null;
}

function projectIdEntry(
  kind: "databaseDeployment" | "dockerDeployment" | "githubDeployment",
  parts: readonly string[]
): ProjectSideSurfaceEntry | null {
  if (parts.length !== 2) {
    return null;
  }
  const projectId = decodePart(parts[1]);
  return projectId == null ? null : { kind, projectId };
}

function targetFromParts(parts: readonly string[]) {
  return parseProjectTarget(parts.join(":"));
}

function apTargetFromParts(parts: readonly string[]): ProjectApTarget | null {
  const target = targetFromParts(parts);
  return target?.kind === "AP" ? target : null;
}

function dbTargetFromParts(parts: readonly string[]): ProjectDbTarget | null {
  const target = targetFromParts(parts);
  return target?.kind === "DB" ? target : null;
}

function resourceTargetFromParts(
  parts: readonly string[]
): ProjectResourceTarget | null {
  const target = targetFromParts(parts);
  return target?.kind === "AP" || target?.kind === "DB" ? target : null;
}

function entryTargetFromParts(
  parts: readonly string[]
): ProjectApBoundEntryPointTarget | null {
  const target = targetFromParts(parts);
  return target?.kind === "EntryPoint" ? target : null;
}

function serializeTargetEntry(prefix: string, target: ProjectResourceTarget) {
  return `${prefix}:${serializeProjectTarget(target)}`;
}

function serializeFocusPolicy(policy?: ProjectMainSurfaceFocusPolicy) {
  return policy === "keepSideVisible" ? ":keep-side" : "";
}

function parseFocusPolicy(
  value: string | undefined
): ProjectMainSurfaceFocusPolicy | null {
  if (value == null) {
    return "focusMain";
  }
  if (value === "keep-side") {
    return "keepSideVisible";
  }
  return null;
}

export function serializeProjectSideSurfaceEntry(
  entry: ProjectSideSurfaceEntry | null | undefined
): string | null {
  if (entry == null) {
    return null;
  }
  switch (entry.kind) {
    case "apEvents":
      return serializeTargetEntry("ap-events", entry.target);
    case "apHistory":
      return serializeTargetEntry("ap-history", entry.target);
    case "apMetrics":
      return serializeTargetEntry("ap-metrics", entry.target);
    case "apSettings":
      return serializeTargetEntry("ap-settings", entry.target);
    case "databaseDeployment":
      return `database-deployment:${encodePart(entry.projectId)}`;
    case "dbMetrics":
      return serializeTargetEntry("db-metrics", entry.target);
    case "dbSettings":
      return serializeTargetEntry("db-settings", entry.target);
    case "dockerDeployment":
      return `docker-deployment:${encodePart(entry.projectId)}`;
    case "githubDeployment":
      return `github-deployment:${encodePart(entry.projectId)}`;
    case "projectCreation":
      return `project-creation:${encodePart(entry.entryMode)}`;
    case "skillsWorkflow":
      return "skills-workflow";
    case "publicAddresses":
      return `public-addresses:${serializeProjectTarget(entry.target)}`;
    default:
      return null;
  }
}

function parseResourceSideSurfaceEntry(
  parts: readonly string[]
): ProjectSideSurfaceEntry | null | undefined {
  switch (parts[0]) {
    case "ap-events": {
      const target = apTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "apEvents", target };
    }
    case "ap-history": {
      const target = apTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "apHistory", target };
    }
    case "ap-metrics": {
      const target = apTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "apMetrics", target };
    }
    case "ap-settings": {
      const target = apTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "apSettings", target };
    }
    case "db-metrics": {
      const target = dbTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "dbMetrics", target };
    }
    case "db-settings": {
      const target = dbTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "dbSettings", target };
    }
    case "public-addresses": {
      const target = entryTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "publicAddresses", target };
    }
    default:
      return undefined;
  }
}

function parseProjectCreationSideEntry(
  parts: readonly string[]
): ProjectSideSurfaceEntry | null {
  if (parts.length !== 2) {
    return null;
  }
  const entryMode = decodePart(parts[1]);
  if (
    entryMode !== "general" &&
    entryMode !== "databaseDirect" &&
    entryMode !== "dockerDirect" &&
    entryMode !== "githubDirect"
  ) {
    return null;
  }
  return { entryMode, kind: "projectCreation" };
}

export function parseProjectSideSurfaceEntry(
  value: string | null | undefined
): ProjectSideSurfaceEntry | null {
  const parts = split(value);
  if (parts == null) {
    return null;
  }

  const resourceEntry = parseResourceSideSurfaceEntry(parts);
  if (resourceEntry !== undefined) {
    return resourceEntry;
  }

  switch (parts[0]) {
    case "database-deployment":
      return projectIdEntry("databaseDeployment", parts);
    case "docker-deployment":
      return projectIdEntry("dockerDeployment", parts);
    case "github-deployment":
      return projectIdEntry("githubDeployment", parts);
    case "project-creation":
      return parseProjectCreationSideEntry(parts);
    case "skills-workflow":
      return parts.length === 1 ? { kind: "skillsWorkflow" } : null;
    default:
      return null;
  }
}

export function serializeProjectMainSurfaceEntry(
  entry: ProjectMainSurfaceEntry | null | undefined
): string | null {
  if (entry == null) {
    return null;
  }
  if (entry.kind === "dbAccess") {
    return `db-access:${serializeProjectTarget(entry.target)}${serializeFocusPolicy(entry.focusPolicy)}`;
  }
  return `resource-logs:${serializeProjectTarget(entry.target)}${serializeFocusPolicy(entry.focusPolicy)}`;
}

export function parseProjectMainSurfaceEntry(
  value: string | null | undefined
): ProjectMainSurfaceEntry | null {
  const parts = split(value);
  if (parts == null) {
    return null;
  }
  switch (parts[0]) {
    case "db-access": {
      const focusPolicy = parseFocusPolicy(parts[4]);
      const target = dbTargetFromParts(parts.slice(1, 4));
      if (target == null || focusPolicy == null || parts.length > 5) {
        return null;
      }
      return { focusPolicy, kind: "dbAccess", target };
    }
    case "resource-logs": {
      const focusPolicy = parseFocusPolicy(parts[4]);
      const target = resourceTargetFromParts(parts.slice(1, 4));
      if (target == null || focusPolicy == null || parts.length > 5) {
        return null;
      }
      return { focusPolicy, kind: "resourceLogs", target };
    }
    default:
      return null;
  }
}

export function serializeProjectDrawerSurfaceEntry(
  entry: ProjectDrawerSurfaceEntry | null | undefined
): string | null {
  if (entry == null) {
    return null;
  }
  if (entry.kind === "apTerminal") {
    return `ap-terminal:${serializeProjectTarget(entry.target)}`;
  }
  return `db-terminal:${serializeProjectTarget(entry.target)}`;
}

export function parseProjectDrawerSurfaceEntry(
  value: string | null | undefined
): ProjectDrawerSurfaceEntry | null {
  const parts = split(value);
  if (parts == null) {
    return null;
  }
  switch (parts[0]) {
    case "ap-terminal": {
      const target = apTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "apTerminal", target };
    }
    case "db-terminal": {
      const target = dbTargetFromParts(parts.slice(1));
      return target == null ? null : { kind: "dbTerminal", target };
    }
    default:
      return null;
  }
}

export function parseProjectSurfaceUrlState(input: {
  drawer?: string | null;
  main?: string | null;
  side?: string | null;
}): ProjectSurfaceState {
  return {
    drawer: parseProjectDrawerSurfaceEntry(input.drawer),
    main: parseProjectMainSurfaceEntry(input.main),
    side: parseProjectSideSurfaceEntry(input.side),
  };
}

export function serializeProjectSurfaceUrlState(
  state: ProjectSurfaceState
): Record<string, string> {
  const side = serializeProjectSideSurfaceEntry(state.side);
  const main = serializeProjectMainSurfaceEntry(state.main);
  const drawer = serializeProjectDrawerSurfaceEntry(state.drawer);

  return {
    ...(side == null ? {} : { side }),
    ...(main == null ? {} : { main }),
    ...(drawer == null ? {} : { drawer }),
  };
}
