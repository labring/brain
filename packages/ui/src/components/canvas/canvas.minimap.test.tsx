import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Node,
  ReactFlowProvider,
  type ReactFlowState,
  useStoreApi,
} from "@xyflow/react";
import { Profiler } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Canvas } from "./canvas";
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

test("Canvas.MiniMap renders only when its visible projection changes", async () => {
  const reactTestGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactTestGlobals.IS_REACT_ACT_ENVIRONMENT;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    },
  });
  let store: ReturnType<typeof useStoreApi> | undefined;
  let renderer: ReactTestRenderer | undefined;
  let commits = 0;

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
          <Profiler
            id="canvas-minimap"
            onRender={() => {
              commits += 1;
            }}
          >
            <Canvas.MiniMap />
          </Profiler>
        </Canvas.Root>
      </ReactFlowProvider>
    );
  }

  try {
    await act(() => {
      renderer = create(renderCanvas(EMPTY_CANVAS_STATE));
    });

    const mountedRenderer = renderer;
    assert.ok(mountedRenderer);
    await act(() => {
      mountedRenderer.root
        .findByProps({ "data-slot": "canvas-minimap" })
        .props.onPointerEnter();
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

    const minimapSvg = mountedRenderer.root.findByProps({
      className: "react-flow__minimap-svg",
    });
    const svgPropsBeforeSelection = minimapSvg.props;
    await act(() => {
      mountedRenderer.update(
        renderCanvas({
          ...EMPTY_CANVAS_STATE,
          selectedNode: MINIMAP_NODE,
        })
      );
    });

    assert.equal(
      minimapSvg.props,
      svgPropsBeforeSelection,
      "selection-only Canvas context updates must not enter the MiniMap SVG subtree"
    );
    const svgPropsBeforePaneClear = minimapSvg.props;
    await act(() => {
      mountedRenderer.update(renderCanvas(EMPTY_CANVAS_STATE));
    });

    assert.equal(
      minimapSvg.props,
      svgPropsBeforePaneClear,
      "clearing selection from an empty-pane click must not enter the MiniMap SVG subtree"
    );
    commits = 0;

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
    if (renderer !== undefined) {
      await act(() => {
        renderer?.unmount();
      });
    }
    reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previousWindow);
    }
  }
});
