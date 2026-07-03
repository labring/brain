import type {
  ContainerNodeAction,
  ContainerNodeLifecycleActions,
} from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeAction,
  DatabaseNodeLifecycleActions,
} from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
} from "@/features/project-canvas/nodes/types";

const READ_ONLY_RESOURCE_ACTION_REASON =
  "This project is read-only. Resource actions are unavailable.";
const AUTH_UNAVAILABLE_RESOURCE_ACTION_REASON =
  "Resource credentials are not available.";
export const MISSING_RESOURCE_TARGET_REASON = "Resource target is unavailable.";

/** Engines whose native client the platform ships for DB Terminal and DB Access. */
const DB_ENGINES_WITH_CLIENT_SUPPORT = new Set([
  "apecloud-mysql",
  "mongodb",
  "mysql",
  "postgresql",
  "redis",
]);
const DB_TERMINAL_UNSUPPORTED_ENGINE_REASON =
  "Terminal is not available for this database engine.";
const DB_ACCESS_UNSUPPORTED_ENGINE_REASON =
  "Database access is not available for this database engine.";

function dbEngineClientSupported(engineKey: string | undefined): boolean {
  const normalized = engineKey?.trim().toLowerCase() ?? "";
  return normalized === "" || DB_ENGINES_WITH_CLIENT_SUPPORT.has(normalized);
}

export function databaseLiveSessionUnavailableReasons(
  engineKey: string | undefined
): {
  dbAccessReason?: string;
  terminalReason?: string;
} {
  if (dbEngineClientSupported(engineKey)) {
    return {};
  }
  return {
    dbAccessReason: DB_ACCESS_UNSUPPORTED_ENGINE_REASON,
    terminalReason: DB_TERMINAL_UNSUPPORTED_ENGINE_REASON,
  };
}

/**
 * Single source for whether resource mutations are allowed on a node, and
 * the user-facing reason when they are not. Callers must gate every mutation
 * handler on this returning undefined rather than re-deriving policy.
 */
export function resourceActionDisabledReason({
  authReady,
  readOnly,
  targetAvailable,
}: {
  authReady: boolean;
  readOnly: boolean;
  targetAvailable: boolean;
}): string | undefined {
  if (readOnly) {
    return READ_ONLY_RESOURCE_ACTION_REASON;
  }
  if (!authReady) {
    return AUTH_UNAVAILABLE_RESOURCE_ACTION_REASON;
  }
  if (!targetAvailable) {
    return MISSING_RESOURCE_TARGET_REASON;
  }
  return undefined;
}

function unavailableContainerAction(
  disabledReason: string
): ContainerNodeAction {
  return { disabled: true, disabledReason };
}

function unavailableDatabaseAction(disabledReason: string): DatabaseNodeAction {
  return { disabled: true, disabledReason };
}

export function unavailableContainerLifecycleActions(
  disabledReason: string | undefined
): ContainerNodeLifecycleActions | undefined {
  if (disabledReason == null) {
    return undefined;
  }
  return {
    delete: unavailableContainerAction(disabledReason),
    restart: unavailableContainerAction(disabledReason),
    start: unavailableContainerAction(disabledReason),
    stop: unavailableContainerAction(disabledReason),
  };
}

export function unavailableDatabaseLifecycleActions(
  disabledReason: string | undefined
): DatabaseNodeLifecycleActions | undefined {
  if (disabledReason == null) {
    return undefined;
  }
  return {
    delete: unavailableDatabaseAction(disabledReason),
    restart: unavailableDatabaseAction(disabledReason),
    start: unavailableDatabaseAction(disabledReason),
    stop: unavailableDatabaseAction(disabledReason),
  };
}

/**
 * Wraps a runtime model in the minimal Node shape the selection and target
 * helpers read, mirroring how the runtime store hands models to node views.
 */
export function selectionNodeFromModel(
  id: string,
  model: CanvasContainerNodeData | CanvasDatabaseNodeData,
  type: string | undefined
): Node {
  return {
    data: model,
    id,
    position: { x: 0, y: 0 },
    type,
  } as Node;
}
