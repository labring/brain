import { canvasResourceKey } from "../nodes/resource-identity";
import type { CanvasLayoutNode } from "./types";

interface TimerApi {
  clearTimeout: (handle: unknown) => void;
  setTimeout: (
    callback: () => void | Promise<void>,
    delayMs: number
  ) => unknown;
}

function layoutNodeKey(node: CanvasLayoutNode) {
  return `${node.ref.kind}:${node.ref.namespace}:${node.ref.name}`;
}

function layoutNodesEqual(a: CanvasLayoutNode, b: CanvasLayoutNode) {
  return (
    a.expanded === b.expanded &&
    a.lastSeenUid === b.lastSeenUid &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.ref.kind === b.ref.kind &&
    a.ref.name === b.ref.name &&
    a.ref.namespace === b.ref.namespace &&
    a.stackOrder === b.stackOrder
  );
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
  const saved = new Map<string, CanvasLayoutNode>();
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
      for (const node of nodes) {
        saved.set(layoutNodeKey(node), node);
      }
    }
  };

  return {
    cancel,
    flush,
    schedule: (node) => {
      const key = canvasResourceKey(node.ref);
      const previous = pending.get(key) ?? saved.get(key);
      if (previous !== undefined && layoutNodesEqual(previous, node)) {
        return;
      }
      pending.set(key, node);
      cancel();
      timer = options.setTimeout(flush, options.delayMs);
    },
  };
}

export const createCanvasLayoutNodePositionSaveScheduler =
  createCanvasLayoutNodeSaveScheduler;
