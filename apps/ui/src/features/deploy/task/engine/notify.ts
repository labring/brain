/**
 * One global Postgres NOTIFY channel carries every deployment-task change so
 * execution, projection streams, and timeline streams work across server
 * processes (ADR 0037). Payloads are identifiers only; subscribers re-read the
 * row. `purge` is the exception: the row is gone, so the ids are the event.
 * A `reset` event is synthesized locally after the LISTEN connection
 * reconnects — notifications during the gap are lost, so subscribers must
 * re-bootstrap.
 */
export const DEPLOY_TASK_NOTIFY_CHANNEL = "sealai_deploy_task_changed";

export interface DeployTaskNotifyMessage {
  kind: "change" | "purge";
  namespace: string;
  projectId: string | null;
  taskId: string;
}

export type DeployTaskNotifyEvent = DeployTaskNotifyMessage | { kind: "reset" };

export type DeployTaskNotifyListener = (event: DeployTaskNotifyEvent) => void;

export interface DeployTaskNotifyTransport {
  publish: (message: DeployTaskNotifyMessage) => Promise<void>;
  subscribe: (
    listener: DeployTaskNotifyListener
  ) => Promise<() => void | Promise<void>>;
}

export function parseDeployTaskNotifyMessage(
  payload: string | undefined
): DeployTaskNotifyMessage | null {
  if (!payload) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.kind !== "change" && record.kind !== "purge") {
    return null;
  }
  if (
    typeof record.taskId !== "string" ||
    typeof record.namespace !== "string"
  ) {
    return null;
  }
  return {
    kind: record.kind,
    namespace: record.namespace,
    projectId: typeof record.projectId === "string" ? record.projectId : null,
    taskId: record.taskId,
  };
}
