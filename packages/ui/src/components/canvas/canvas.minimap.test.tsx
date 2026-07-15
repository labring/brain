import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react/pure";
import {
  type Node,
  ReactFlowProvider,
  type ReactFlowState,
  useStoreApi,
} from "@xyflow/react";
import { act, memo, Profiler, type ProfilerOnRenderCallback } from "react";

import { Canvas } from "./canvas";
import { CanvasMiniMapViewport } from "./canvas.minimap";
import type { CanvasState } from "./canvas.types";

const EMPTY_CANVAS_STATE: CanvasState = {
  edges: [],
  nodes: [],
  selectedEdge: null,
  selectedNode: null,
};
const MINIMAP_NODE: Node = {
  data: {},
  height: 48,
  id: "node-1",
  position: { x: 80, y: 64 },
  width: 96,
};

function installCanvasTestDom() {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register({ url: "https://canvas.test" });
  return () => GlobalRegistrator.unregister();
}

const ProfiledCanvasMiniMapViewport = memo(
  function ProfiledCanvasMiniMapViewport({
    onRender,
  }: {
    onRender: ProfilerOnRenderCallback;
  }) {
    return (
      <Profiler id="canvas-minimap-viewport" onRender={onRender}>
        <CanvasMiniMapViewport />
      </Profiler>
    );
  }
);

test("Canvas.MiniMap renders only when its visible projection changes", async () => {
  const restoreDom = installCanvasTestDom();
  const reactTestGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactTestGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  let store: ReturnType<typeof useStoreApi> | undefined;
  let rendered: ReturnType<typeof render> | undefined;
  let commits = 0;

  function recordMiniMapCommit() {
    commits += 1;
  }

  function CaptureStore() {
    store = useStoreApi();
    return null;
  }

  function renderCanvas(state: CanvasState) {
    return (
      <ReactFlowProvider
        initialEdges={[]}
        initialHeight={600}
        initialNodes={[MINIMAP_NODE]}
        initialWidth={800}
      >
        <Canvas.Root state={state}>
          <CaptureStore />
          <ProfiledCanvasMiniMapViewport onRender={recordMiniMapCommit} />
        </Canvas.Root>
      </ReactFlowProvider>
    );
  }

  try {
    await act(() => {
      rendered = render(renderCanvas(EMPTY_CANVAS_STATE));
    });

    commits = 0;
    const flowStore = store;
    assert.ok(flowStore);
    await act(() => {
      flowStore.setState({
        nodesSelectionActive: false,
      } as Partial<ReactFlowState>);
    });

    assert.equal(commits, 0);

    await act(() => {
      flowStore.getState().setNodes([{ ...MINIMAP_NODE, selected: true }]);
    });

    assert.equal(commits, 0);

    const mounted = rendered;
    assert.ok(mounted);
    await act(() => {
      mounted.rerender(
        renderCanvas({
          ...EMPTY_CANVAS_STATE,
          selectedNode: MINIMAP_NODE,
        })
      );
    });

    assert.equal(
      commits,
      0,
      "selection-only Canvas context updates must not enter the MiniMap SVG subtree"
    );
    await act(() => {
      mounted.rerender(renderCanvas(EMPTY_CANVAS_STATE));
    });

    assert.equal(
      commits,
      0,
      "clearing selection from an empty-pane click must not enter the MiniMap SVG subtree"
    );

    await act(() => {
      flowStore.getState().setNodes([
        {
          ...MINIMAP_NODE,
          position: { x: MINIMAP_NODE.position.x + 16, y: 64 },
          selected: true,
        },
      ]);
    });

    assert.equal(commits, 1);
    commits = 0;

    await act(() => {
      flowStore.setState({ transform: [24, 0, 1] } as Partial<ReactFlowState>);
    });

    assert.equal(commits, 1);
  } finally {
    if (rendered !== undefined) {
      await act(() => {
        rendered?.unmount();
      });
    }
    reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    await restoreDom();
  }
});
