"use client";

import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import {
  fetchProjectCanvasLayout,
  PROJECT_CANVAS_LAYOUT_API_PATH,
  patchProjectCanvasLayoutNodes,
} from "@/features/project-canvas/layout/client";
import { canvasLayoutNodeFromNode } from "@/features/project-canvas/layout/merge";
import { createCanvasLayoutNodeSaveScheduler } from "@/features/project-canvas/layout/scheduler";

const NODE_LAYOUT_SAVE_DEBOUNCE_MS = 600;

function layoutNodeSignature(
  node: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"][number]
) {
  return layoutNodeSignatureWithOptions(node, { normalizeOrphanedAt: false });
}

function layoutNodeCanonicalSignature(
  node: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"][number]
) {
  return layoutNodeSignatureWithOptions(node, { normalizeOrphanedAt: true });
}

function layoutNodeSignatureWithOptions(
  node: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"][number],
  options: { normalizeOrphanedAt: boolean }
) {
  return JSON.stringify({
    expanded: node.expanded ?? null,
    lastSeenUid: node.lastSeenUid ?? null,
    orphanedAt: layoutNodeOrphanedAtSignature(node, options),
    position: node.position,
    ref: node.ref,
    stackOrder: node.stackOrder ?? null,
  });
}

function layoutNodeOrphanedAtSignature(
  node: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"][number],
  options: { normalizeOrphanedAt: boolean }
) {
  if (!options.normalizeOrphanedAt) {
    return node.orphanedAt ?? null;
  }
  return node.orphanedAt === undefined ? null : "present";
}

function layoutNodesSignature(
  nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"]
) {
  return layoutNodesSignatureWithOptions(nodes, { normalizeOrphanedAt: false });
}

function layoutNodesCanonicalSignature(
  nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"]
) {
  return layoutNodesSignatureWithOptions(nodes, { normalizeOrphanedAt: true });
}

function layoutNodesSignatureWithOptions(
  nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"],
  options: { normalizeOrphanedAt: boolean }
) {
  return nodes
    .map(
      (node) =>
        `${node.ref.kind}:${node.ref.namespace}:${node.ref.name}:${options.normalizeOrphanedAt ? layoutNodeCanonicalSignature(node) : layoutNodeSignature(node)}`
    )
    .sort()
    .join("|");
}

export function useProjectCanvasLayout(options: {
  enabled?: boolean;
  namespace: string;
  projectId: string;
}) {
  const namespace = options.namespace.trim();
  const projectId = options.projectId.trim();
  const enabled =
    options.enabled === true && namespace !== "" && projectId !== "";

  const swrKey = enabled
    ? ([PROJECT_CANVAS_LAYOUT_API_PATH, namespace, projectId] as const)
    : null;
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () =>
      fetchProjectCanvasLayout({
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
  const saveNodes = useCallback(
    async (
      nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"]
    ) => {
      if (!enabled) {
        return;
      }
      const nextSignature = layoutNodesSignature(nodes);
      const nextCanonicalSignature = layoutNodesCanonicalSignature(nodes);
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
          namespace,
          nodes,
          projectId,
        });
        lastSavedNodesSignatureRef.current = layoutNodesSignature(next.nodes);
        lastSavedNodesCanonicalSignatureRef.current =
          layoutNodesCanonicalSignature(next.nodes);
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
    [enabled, mutate, namespace, projectId]
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
    (node: Node) => {
      if (!enabled) {
        return;
      }
      const layoutNode = canvasLayoutNodeFromNode(node);
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
    saveLayoutNodes: saveNodes,
    scheduleNodeLayoutSave,
    scheduleNodePositionSave: scheduleNodeLayoutSave,
  };
}
