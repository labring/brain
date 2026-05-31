export interface ProjectApTarget {
  kind: "AP";
  name: string;
  namespace: string;
  observedUid?: string;
}

export interface ProjectDbTarget {
  kind: "DB";
  name: string;
  namespace: string;
  observedUid?: string;
}

export interface ProjectApBoundEntryPointTarget {
  apName: string;
  kind: "EntryPoint";
  namespace: string;
  observedUid?: string;
}

export type ProjectResourceTarget = ProjectApTarget | ProjectDbTarget;
export type ProjectSurfaceTarget =
  | ProjectResourceTarget
  | ProjectApBoundEntryPointTarget;

function cleanPart(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }
  try {
    return cleanPart(decodeURIComponent(value));
  } catch {
    return null;
  }
}

export function projectTargetKey(target: ProjectSurfaceTarget): string {
  if (target.kind === "EntryPoint") {
    return `entry:${target.namespace}:${target.apName}`;
  }
  return `${target.kind}:${target.namespace}:${target.name}`;
}

export function targetsEqual(
  left: ProjectSurfaceTarget | null | undefined,
  right: ProjectSurfaceTarget | null | undefined
): boolean {
  if (left == null || right == null) {
    return left == null && right == null;
  }
  return projectTargetKey(left) === projectTargetKey(right);
}

export function serializeProjectTarget(target: ProjectSurfaceTarget): string {
  if (target.kind === "AP") {
    return `ap:${encodePart(target.namespace)}:${encodePart(target.name)}`;
  }
  if (target.kind === "DB") {
    return `db:${encodePart(target.namespace)}:${encodePart(target.name)}`;
  }
  return `entry:${encodePart(target.namespace)}:${encodePart(target.apName)}`;
}

export function parseProjectTarget(
  value: string | null | undefined
): ProjectSurfaceTarget | null {
  const parts = value?.split(":");
  if (parts?.length !== 3) {
    return null;
  }
  const namespace = decodePart(parts[1]);
  const name = decodePart(parts[2]);
  if (namespace == null || name == null) {
    return null;
  }

  switch (parts[0]) {
    case "ap":
      return { kind: "AP", name, namespace };
    case "db":
      return { kind: "DB", name, namespace };
    case "entry":
      return { apName: name, kind: "EntryPoint", namespace };
    default:
      return null;
  }
}

export function projectApTarget(input: {
  name: string;
  namespace: string;
  observedUid?: string;
}): ProjectApTarget | null {
  const name = cleanPart(input.name);
  const namespace = cleanPart(input.namespace);
  if (name == null || namespace == null) {
    return null;
  }
  return {
    kind: "AP",
    name,
    namespace,
    ...(input.observedUid?.trim()
      ? { observedUid: input.observedUid.trim() }
      : {}),
  };
}

export function projectDbTarget(input: {
  name: string;
  namespace: string;
  observedUid?: string;
}): ProjectDbTarget | null {
  const name = cleanPart(input.name);
  const namespace = cleanPart(input.namespace);
  if (name == null || namespace == null) {
    return null;
  }
  return {
    kind: "DB",
    name,
    namespace,
    ...(input.observedUid?.trim()
      ? { observedUid: input.observedUid.trim() }
      : {}),
  };
}

export function projectApBoundEntryPointTarget(input: {
  apName: string;
  namespace: string;
  observedUid?: string;
}): ProjectApBoundEntryPointTarget | null {
  const apName = cleanPart(input.apName);
  const namespace = cleanPart(input.namespace);
  if (apName == null || namespace == null) {
    return null;
  }
  return {
    apName,
    kind: "EntryPoint",
    namespace,
    ...(input.observedUid?.trim()
      ? { observedUid: input.observedUid.trim() }
      : {}),
  };
}
