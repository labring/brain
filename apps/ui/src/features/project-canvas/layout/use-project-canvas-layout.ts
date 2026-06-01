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

export function useProjectCanvasLayout(options: {
  enabled?: boolean;
  namespace: string;
  projectUid: string;
}) {
  const namespace = options.namespace.trim();
  const projectUid = options.projectUid.trim();
  const enabled =
    options.enabled === true && namespace !== "" && projectUid !== "";

  const swrKey = enabled
    ? ([PROJECT_CANVAS_LAYOUT_API_PATH, namespace, projectUid] as const)
    : null;
  const { data, error, isLoading, mutate } = useSWR(swrKey, () =>
    fetchProjectCanvasLayout({
      namespace,
      projectUid,
    })
  );

  const loadToastKey = enabled ? `${namespace}:${projectUid}` : "";
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

  const saveNodes = useCallback(
    async (
      nodes: Parameters<typeof patchProjectCanvasLayoutNodes>[0]["nodes"]
    ) => {
      if (!enabled) {
        return;
      }
      try {
        const next = await patchProjectCanvasLayoutNodes({
          namespace,
          nodes,
          projectUid,
        });
        await mutate(next, { revalidate: false });
      } catch {
        toast.error(
          "Could not save canvas layout. Your local position is still visible."
        );
      }
    },
    [enabled, mutate, namespace, projectUid]
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
