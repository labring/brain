import type { Connection, Node } from "@xyflow/react";
import {
  classifyProjectCanvasConnectionCommand,
  type ProjectCanvasConnectionCommand,
} from "@/features/project-canvas/flow/connection-command";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import { projectApTarget } from "@/features/project-surfaces/target-identity";
import type {
  ApSettingsConfirmedAddDbDsnReference,
  ApSettingsPendingDbReference,
} from "@/features/resource-settings/ap/ap-settings-sections";
import type { ProjectCanvasCommandPlan } from "./command-plan";

export interface PendingApDbReferenceDraftRegistration {
  cleanup?: () => void;
  signature: string;
}

export type PendingApDbReferencesStartHandler = (
  references: readonly PendingApDbCanvasReference[]
) => (() => void) | undefined;

export type PendingApDbReferenceMutationStartHandler = (
  references: readonly ApSettingsConfirmedAddDbDsnReference[]
) => (() => void) | undefined;

export function createPendingApDbReferenceMutationStartHandler({
  apName,
  apNamespace,
  onBeforeStart,
  onPendingApDbReferencesStart,
}: {
  apName: string;
  apNamespace: string;
  onBeforeStart?: () => void;
  onPendingApDbReferencesStart: PendingApDbReferencesStartHandler | undefined;
}): PendingApDbReferenceMutationStartHandler | undefined {
  if (
    onPendingApDbReferencesStart === undefined ||
    apName === "" ||
    apNamespace === ""
  ) {
    return undefined;
  }

  return (references) => {
    onBeforeStart?.();
    return onPendingApDbReferencesStart(
      references.map((reference) => ({
        id: reference.id,
        source: {
          kind: "AP",
          name: apName,
          namespace: apNamespace,
        },
        target: {
          kind: "DB",
          name: reference.dbName,
          namespace: reference.dbNamespace,
        },
      }))
    );
  };
}

export function pendingApDbReferenceDraftKey({
  apName,
  apNamespace,
}: {
  apName: string;
  apNamespace: string;
}): string {
  return `${apNamespace}/${apName}`;
}

function pendingApDbCanvasReferenceId({
  apName,
  apNamespace,
  dbName,
  dbNamespace,
}: {
  apName: string;
  apNamespace: string;
  dbName: string;
  dbNamespace: string;
}): string {
  return `draft:${apNamespace}/${apName}->${dbNamespace}/${dbName}`;
}

export function pendingApDbCanvasReferencesFromDraftReferences({
  apName,
  apNamespace,
  references,
}: {
  apName: string;
  apNamespace: string;
  references: readonly ApSettingsPendingDbReference[];
}): PendingApDbCanvasReference[] {
  if (apName === "" || apNamespace === "") {
    return [];
  }
  return references.map((reference) => ({
    id: pendingApDbCanvasReferenceId({
      apName,
      apNamespace,
      dbName: reference.dbName,
      dbNamespace: reference.dbNamespace,
    }),
    source: {
      kind: "AP",
      name: apName,
      namespace: apNamespace,
    },
    target: {
      kind: "DB",
      name: reference.dbName,
      namespace: reference.dbNamespace,
    },
  }));
}

export function pendingApDbReferenceDraftSignature(
  references: readonly PendingApDbCanvasReference[]
): string {
  return references
    .map((reference) =>
      [
        reference.id,
        reference.source.kind,
        reference.source.namespace,
        reference.source.name,
        reference.target.kind,
        reference.target.namespace,
        reference.target.name,
      ].join(":")
    )
    .sort()
    .join("|");
}

function planApDbConnectionCommand(
  command: Extract<
    ProjectCanvasConnectionCommand,
    { kind: "openApDbAddReference" }
  >
): ProjectCanvasCommandPlan {
  const target = projectApTarget({
    name: command.ap.name,
    namespace: command.ap.namespace,
    observedUid: command.ap.uid,
  });
  if (target == null) {
    return {
      feedback: {
        message: "Could not open AP settings for this connection.",
        tone: "error",
      },
    };
  }

  return {
    guard: { action: "switch", kind: "settingsLeave" },
    pendingDbReference: {
      apNodeId: command.ap.nodeId,
      dbName: command.db.name,
      dbNamespace: command.db.namespace,
    },
    selection: { kind: "resource", target },
    surface: {
      entry: { kind: "settings", target, view: "environment" },
      slot: "side",
    },
  };
}

export function planDatabaseBindingIntent({
  connection,
  nodes,
  readOnly,
}: {
  connection: Connection;
  nodes: readonly Node[];
  readOnly: boolean;
}): ProjectCanvasCommandPlan {
  const command = classifyProjectCanvasConnectionCommand({
    connection,
    nodes,
    readOnly,
  });

  if (command.kind !== "discard") {
    return planApDbConnectionCommand(command);
  }

  if (command.reason === "readOnly") {
    return {};
  }

  return {
    feedback: {
      message: "That canvas connection is not supported yet.",
      tone: "info",
    },
  };
}
