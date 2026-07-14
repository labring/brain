"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import {
  createPendingApDbReferenceMutationStartHandler,
  type PendingApDbReferenceDraftRegistration,
  pendingApDbCanvasReferencesFromDraftReferences,
  pendingApDbReferenceDraftKey,
  pendingApDbReferenceDraftSignature,
} from "@/features/project-canvas/workbench/database-binding-intents";
import type { ApSettingsPendingDbReference } from "@/features/resource-settings/ap/ap-settings-sections";

/**
 * Bridges AP Settings pending DB reference drafts into pending canvas
 * connections. Returns a per-AP session-events factory for the settings
 * side pane.
 */
export function useApSettingsSessionEvents({
  onPendingApDbReferencesStart,
}: {
  onPendingApDbReferencesStart?: (
    references: readonly PendingApDbCanvasReference[]
  ) => (() => void) | undefined;
}) {
  const pendingApDbReferenceDraftByApKey = useRef<
    Map<string, PendingApDbReferenceDraftRegistration>
  >(new Map());
  const pendingDbReferencesChangeHandlerByApKey = useRef<
    Map<string, (references: readonly ApSettingsPendingDbReference[]) => void>
  >(new Map());

  const handlePendingDbReferencesChange = useCallback(
    (change: {
      apName: string;
      apNamespace: string;
      references: readonly ApSettingsPendingDbReference[];
    }) => {
      const draftByApKey = pendingApDbReferenceDraftByApKey.current;
      const draftKey = pendingApDbReferenceDraftKey({
        apName: change.apName,
        apNamespace: change.apNamespace,
      });
      const references = pendingApDbCanvasReferencesFromDraftReferences({
        apName: change.apName,
        apNamespace: change.apNamespace,
        references: change.references,
      });
      const signature = pendingApDbReferenceDraftSignature(references);
      const existing = draftByApKey.get(draftKey);
      if (existing?.signature === signature) {
        return;
      }

      existing?.cleanup?.();
      draftByApKey.delete(draftKey);

      if (references.length === 0 || onPendingApDbReferencesStart == null) {
        return;
      }

      const cleanup = onPendingApDbReferencesStart(references);
      draftByApKey.set(draftKey, { cleanup, signature });
    },
    [onPendingApDbReferencesStart]
  );

  const handlePendingDbReferencesChangeRef = useRef(
    handlePendingDbReferencesChange
  );
  handlePendingDbReferencesChangeRef.current = handlePendingDbReferencesChange;

  const pendingDbReferencesChangeHandlerForAp = useCallback(
    ({ apName, apNamespace }: { apName: string; apNamespace: string }) => {
      const draftKey = pendingApDbReferenceDraftKey({ apName, apNamespace });
      const existing =
        pendingDbReferencesChangeHandlerByApKey.current.get(draftKey);
      if (existing !== undefined) {
        return existing;
      }

      const handler = (references: readonly ApSettingsPendingDbReference[]) => {
        handlePendingDbReferencesChangeRef.current({
          apName,
          apNamespace,
          references,
        });
      };
      pendingDbReferencesChangeHandlerByApKey.current.set(draftKey, handler);
      return handler;
    },
    []
  );

  const apSettingsSessionEventsForAp = useCallback(
    ({ name, namespace }: { name: string; namespace: string }) => {
      const apName = name.trim();
      const apNamespace = namespace.trim();
      return {
        onAddDbDsnReferenceMutationStart:
          createPendingApDbReferenceMutationStartHandler({
            apName,
            apNamespace,
            onBeforeStart: () => {
              const draftByApKey = pendingApDbReferenceDraftByApKey.current;
              const draftKey = pendingApDbReferenceDraftKey({
                apName,
                apNamespace,
              });
              draftByApKey.get(draftKey)?.cleanup?.();
              draftByApKey.delete(draftKey);
            },
            onPendingApDbReferencesStart,
          }),
        onPendingDbReferencesChange: pendingDbReferencesChangeHandlerForAp({
          apName,
          apNamespace,
        }),
      };
    },
    [onPendingApDbReferencesStart, pendingDbReferencesChangeHandlerForAp]
  );

  useEffect(
    () => () => {
      const draftByApKey = pendingApDbReferenceDraftByApKey.current;
      for (const { cleanup } of draftByApKey.values()) {
        cleanup?.();
      }
      draftByApKey.clear();
      pendingDbReferencesChangeHandlerByApKey.current.clear();
    },
    []
  );

  return { apSettingsSessionEventsForAp };
}
