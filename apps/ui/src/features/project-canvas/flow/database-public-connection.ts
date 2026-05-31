import type {
  DatabaseNodeConnection,
  DatabaseNodePublicConnection,
} from "@workspace/ui/components/database-node/database-node";

export type DatabasePublicAccessPendingTarget = boolean | undefined;

export function resolveDatabasePublicConnection(
  connection: DatabaseNodePublicConnection,
  pendingTarget: DatabasePublicAccessPendingTarget
): DatabaseNodePublicConnection {
  const serverEnabled = connection.publicAccess.enabled;
  const effectiveEnabled = pendingTarget ?? serverEnabled;
  const loading = pendingTarget !== undefined;
  const canExposeServerValue = serverEnabled && effectiveEnabled;
  const { displayValue, value, ...connectionWithoutValue } = connection;

  return {
    ...connectionWithoutValue,
    ...(canExposeServerValue && displayValue !== undefined
      ? { displayValue }
      : {}),
    ...(canExposeServerValue && value !== undefined ? { value } : {}),
    publicAccess: {
      ...connection.publicAccess,
      enabled: effectiveEnabled,
      ...(loading ? { loading: true } : {}),
    },
  };
}

export function resolveDatabasePublicConnections(
  connections: DatabaseNodeConnection[],
  pendingTarget: DatabasePublicAccessPendingTarget
): DatabaseNodeConnection[] {
  return connections.map((connection) =>
    connection.kind === "public"
      ? resolveDatabasePublicConnection(connection, pendingTarget)
      : connection
  );
}
