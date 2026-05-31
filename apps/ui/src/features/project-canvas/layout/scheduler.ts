import { canvasResourceKey } from "../nodes/resource-identity";
import type { CanvasLayoutNode } from "./types";

interface TimerApi {
  clearTimeout: (handle: unknown) => void;
  setTimeout: (
    callback: () => void | Promise<void>,
    delayMs: number
  ) => unknown;
}

export interface CanvasLayoutNodeSaveScheduler {
  cancel: () => void;
  flush: () => Promise<void>;
  schedule: (node: CanvasLayoutNode) => void;
}

export function createCanvasLayoutNodeSaveScheduler(
  options: TimerApi & {
    delayMs: number;
    save: (nodes: CanvasLayoutNode[]) => Promise<void>;
  }
): CanvasLayoutNodeSaveScheduler {
  const pending = new Map<string, CanvasLayoutNode>();
  let timer: unknown;

  const cancel = () => {
    if (timer !== undefined) {
      options.clearTimeout(timer);
      timer = undefined;
    }
  };

  const flush = async () => {
    cancel();
    const nodes = Array.from(pending.values());
    pending.clear();
    if (nodes.length > 0) {
      await options.save(nodes);
    }
  };

  return {
    cancel,
    flush,
    schedule: (node) => {
      pending.set(canvasResourceKey(node.ref), node);
      cancel();
      timer = options.setTimeout(flush, options.delayMs);
    },
  };
}

export const createCanvasLayoutNodePositionSaveScheduler =
  createCanvasLayoutNodeSaveScheduler;
