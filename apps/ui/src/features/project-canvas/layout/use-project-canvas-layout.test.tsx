import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@testing-library/react/pure";
import type { Node } from "@xyflow/react";
import { SWRConfig } from "swr";

import {
  actAndDrain,
  installTestDom,
  jsonResponse,
  restoreActEnvironment,
  restoreGlobal,
  type StubbedFetchCall,
  setActEnvironment,
  stubFetch,
} from "@/features/project-canvas/react-test-harness";
import { CANVAS_CONTAINER_NODE_TYPE } from "../nodes/constants";
import { useProjectCanvasLayout } from "./use-project-canvas-layout";

/** Comfortably past the 600ms save debounce. */
const SAVE_FLUSH_WAIT_MS = 700;

function apNode(name: string): Node {
  return {
    data: {
      states: { name, namespace: "default" },
    },
    id: `ap-${name}`,
    position: { x: 12, y: 34 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
}

function layoutDocument(namespace: string) {
  return { namespace, nodes: [], projectId: "p1", version: 1 };
}

interface LayoutHarness {
  cleanup: () => Promise<void>;
  latest: () => ReturnType<typeof useProjectCanvasLayout>;
  patchCalls: () => StubbedFetchCall[];
  setNamespace: (namespace: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
}

async function mountLayoutHook(): Promise<LayoutHarness> {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  let namespace = "ns-a";
  const fetchStub = stubFetch(() => jsonResponse(layoutDocument(namespace)));

  let latest: ReturnType<typeof useProjectCanvasLayout> | undefined;
  function Harness(props: { namespace: string }) {
    latest = useProjectCanvasLayout({
      enabled: true,
      kubeconfig: "test-kubeconfig",
      namespace: props.namespace,
      projectId: "p1",
    });
    return null;
  }

  function tree(current: string) {
    return (
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <Harness namespace={current} />
      </SWRConfig>
    );
  }

  let rendered: ReturnType<typeof render> | undefined;
  await actAndDrain(() => {
    rendered = render(tree(namespace));
  });

  return {
    cleanup: async () => {
      await actAndDrain(() => {
        rendered?.unmount();
      });
      restoreGlobal(fetchStub.override);
      restoreActEnvironment(previousActEnvironment);
      await dom.restore();
    },
    latest: () => {
      if (latest === undefined) {
        throw new Error("layout hook did not render");
      }
      return latest;
    },
    patchCalls: () => fetchStub.calls.filter((call) => call.method === "PATCH"),
    setNamespace: async (next) => {
      namespace = next;
      await actAndDrain(() => {
        rendered?.rerender(tree(next));
      });
    },
    wait: (ms) => actAndDrain(() => undefined, ms),
  };
}

test("debounced node-layout save flushes against an unchanged target", async () => {
  const harness = await mountLayoutHook();
  try {
    await actAndDrain(() => {
      harness.latest().scheduleNodeLayoutSave(apNode("api"));
    });
    assert.equal(harness.patchCalls().length, 0);
    await harness.wait(SAVE_FLUSH_WAIT_MS);
    assert.equal(harness.patchCalls().length, 1);
  } finally {
    await harness.cleanup();
  }
});

test("a pending save dies with its save target instead of flushing into the next one", async () => {
  const harness = await mountLayoutHook();
  try {
    await actAndDrain(() => {
      harness.latest().scheduleNodeLayoutSave(apNode("api"));
    });
    await harness.setNamespace("ns-b");
    await harness.wait(SAVE_FLUSH_WAIT_MS);
    assert.equal(harness.patchCalls().length, 0);
  } finally {
    await harness.cleanup();
  }
});

/** Keep in sync with NODE_LAYOUT_SAVE_DEBOUNCE_MS in use-project-canvas-layout.ts. */
const SAVE_DEBOUNCE_MS = 600;

test("a flush firing between the target-switch commit and scheduler cleanup is dropped", async () => {
  const capturedFlushes: Array<() => unknown> = [];
  const realSetTimeout = globalThis.setTimeout;
  const harness = await mountLayoutHook();
  try {
    // Capture the debounce timer instead of arming it, so the flush can be
    // replayed by hand inside the race window real timers cannot hit
    // deterministically: the insertion effect repoints saveNodesRef at the
    // next target during commit, while the effect cleanup only cancels the
    // old scheduler after paint — a timer landing between the two fires with
    // the old scheduler's nodes against the new target's save.
    globalThis.setTimeout = ((callback: () => unknown, delayMs?: number) => {
      if (delayMs === SAVE_DEBOUNCE_MS) {
        capturedFlushes.push(callback);
        return 0;
      }
      return realSetTimeout(callback, delayMs);
    }) as unknown as typeof setTimeout;

    await actAndDrain(() => {
      harness.latest().scheduleNodeLayoutSave(apNode("api"));
    });
    assert.equal(capturedFlushes.length, 1);

    await harness.setNamespace("ns-b");
    await actAndDrain(async () => {
      await capturedFlushes[0]?.();
    });
    assert.equal(harness.patchCalls().length, 0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await harness.cleanup();
  }
});
