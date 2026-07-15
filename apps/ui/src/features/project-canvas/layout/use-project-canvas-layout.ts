"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import {
  fetchProjectCanvasLayout,
  PROJECT_CANVAS_LAYOUT_API_PATH,
  patchProjectCanvasLayoutNodes,
} from "@/features/project-canvas/layout/client";
import {
  canvasLayoutNodesCanonicalSignature,
  canvasLayoutNodesSignature,
} from "@/features/project-canvas/layout/layout-node-equality";
import { canvasLayoutNodeFromNode } from "@/features/project-canvas/layout/merge";
import { createCanvasLayoutNodeSaveScheduler } from "@/features/project-canvas/layout/scheduler";
import type { CanvasLayoutDocument, PlacementCommand } from "./types";

const NODE_LAYOUT_SAVE_DEBOUNCE_MS = 600;

function isCanvasLayoutRevisionConflictError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("revision conflict")
  );
}

export function useProjectCanvasLayout(options: {
  enabled?: boolean;
  kubeconfig: string;
  namespace: string;
  projectId: string;
}) {
  const kubeconfig = options.kubeconfig.trim();
  const namespace = options.namespace.trim();
  const projectId = options.projectId.trim();
  const enabled =
    options.enabled === true &&
    kubeconfig !== "" &&
    namespace !== "" &&
    projectId !== "";
  const credentialKey = useMemo(
    () => kubeconfigCredentialKey(kubeconfig),
    [kubeconfig]
  );

  const swrKey = enabled
    ? ([
        PROJECT_CANVAS_LAYOUT_API_PATH,
        namespace,
        projectId,
        credentialKey,
      ] as const)
    : null;
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () =>
      fetchProjectCanvasLayout({
        kubeconfig,
        namespace,
        projectId,
      }),
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  const loadToastKey = enabled ? `${namespace}:${projectId}` : "";
  const loadToastShownForRef = useRef("");
  useEffect(() => {
    if (error == null || loadToastKey === "") {
      return;
    }
    if (loadToastShownForRef.current === loadToastKey) {
      return;
    }
    loadToastShownForRef.current = loadToastKey;
    toast.error("Could not load saved canvas layout. Showing detected graph.");
  }, [error, loadToastKey]);

  const inFlightNodesSignatureRef = useRef("");
  const inFlightNodesCanonicalSignatureRef = useRef("");
  const lastSavedNodesCanonicalSignatureRef = useRef("");
  const lastSavedNodesSignatureRef = useRef("");
  const rememberSavedLayout = useCallback(
    (nodes: CanvasLayoutDocument["nodes"]) => {
      lastSavedNodesSignatureRef.current = canvasLayoutNodesSignature(nodes);
      lastSavedNodesCanonicalSignatureRef.current =
        canvasLayoutNodesCanonicalSignature(nodes);
    },
    []
  );
  const savePatchWithConflictRefresh = useCallback(
    async (
      input: Pick<
        Parameters<typeof patchProjectCanvasLayoutNodes>[0],
        "commands" | "expectedVersion" | "intent" | "nodes"
      >
    ) => {
      if (!enabled) {
        return;
      }
      try {
        const next = await patchProjectCanvasLayoutNodes({
          ...input,
          kubeconfig,
          namespace,
          projectId,
        });
        rememberSavedLayout(next.nodes);
        await mutate(next, { revalidate: false });
      } catch (error) {
        if (!isCanvasLayoutRevisionConflictError(error)) {
          throw error;
        }
        const latest = await fetchProjectCanvasLayout({
          kubeconfig,
          namespace,
          projectId,
        });
        rememberSavedLayout(latest.nodes);
        await mutate(latest, { revalidate: false });
      }
    },
    [enabled, kubeconfig, mutate, namespace, projectId, rememberSavedLayout]
  );
  const saveNodes = useCallback(
    async (
      nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"],
      options?: {
        intent?: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["intent"];
      }
    ) => {
      if (!enabled) {
        return;
      }
      const nextSignature = canvasLayoutNodesSignature(nodes);
      const nextCanonicalSignature = canvasLayoutNodesCanonicalSignature(nodes);
      if (
        nextSignature === lastSavedNodesSignatureRef.current ||
        nextSignature === inFlightNodesSignatureRef.current ||
        nextCanonicalSignature ===
          lastSavedNodesCanonicalSignatureRef.current ||
        nextCanonicalSignature === inFlightNodesCanonicalSignatureRef.current
      ) {
        return;
      }
      inFlightNodesSignatureRef.current = nextSignature;
      inFlightNodesCanonicalSignatureRef.current = nextCanonicalSignature;
      try {
        const next = await patchProjectCanvasLayoutNodes({
          ...(options?.intent === undefined ? {} : { intent: options.intent }),
          kubeconfig,
          namespace,
          nodes,
          projectId,
        });
        rememberSavedLayout(next.nodes);
        await mutate(next, { revalidate: false });
      } catch {
        toast.error(
          "Could not save canvas layout. Your local position is still visible."
        );
      } finally {
        if (inFlightNodesSignatureRef.current === nextSignature) {
          inFlightNodesSignatureRef.current = "";
        }
        if (
          inFlightNodesCanonicalSignatureRef.current === nextCanonicalSignature
        ) {
          inFlightNodesCanonicalSignatureRef.current = "";
        }
      }
    },
    [enabled, kubeconfig, mutate, namespace, projectId, rememberSavedLayout]
  );
  const savePlacementCommands = useCallback(
    async (
      commands: PlacementCommand[],
      options?: { expectedVersion?: number }
    ) => {
      if (commands.length === 0) {
        return;
      }
      await savePatchWithConflictRefresh({
        commands,
        expectedVersion: options?.expectedVersion,
        nodes: [],
      });
    },
    [savePatchWithConflictRefresh]
  );
  const saveLayoutTransaction = useCallback(
    async (input: {
      commands: PlacementCommand[];
      expectedVersion: number;
      nodes: CanvasLayoutDocument["nodes"];
    }) => {
      if (input.commands.length === 0 && input.nodes.length === 0) {
        return;
      }
      await savePatchWithConflictRefresh({
        commands: input.commands,
        expectedVersion: input.expectedVersion,
        intent: "layout",
        nodes: input.nodes,
      });
    },
    [savePatchWithConflictRefresh]
  );
  const saveFirstPlacementNodes = useCallback(
    (nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"]) =>
      saveNodes(nodes, { intent: "first-placement" }),
    [saveNodes]
  );

  const scheduler = useMemo(
    () =>
      createCanvasLayoutNodeSaveScheduler({
        clearTimeout: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
        delayMs: NODE_LAYOUT_SAVE_DEBOUNCE_MS,
        save: saveNodes,
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      }),
    [saveNodes]
  );

  useEffect(() => () => scheduler.cancel(), [scheduler]);

  const scheduleNodeLayoutSave = useCallback(
    (node: Node, options?: Parameters<typeof canvasLayoutNodeFromNode>[1]) => {
      if (!enabled) {
        return;
      }
      const layoutNode = canvasLayoutNodeFromNode(node, options);
      if (layoutNode !== undefined) {
        scheduler.schedule(layoutNode);
      }
    },
    [enabled, scheduler]
  );

  return {
    layout: data,
    layoutLoadError: error instanceof Error ? error : undefined,
    layoutReady: !(enabled && isLoading) || error != null,
    saveFirstPlacementNodes,
    saveLayoutTransaction,
    saveLayoutNodes: saveNodes,
    savePlacementCommands,
    scheduleNodeLayoutSave,
    scheduleNodePositionSave: scheduleNodeLayoutSave,
  };
}
