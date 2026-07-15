import assert from "node:assert/strict";
import { test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

function ExpansionProbe() {
  const expansion = useCanvasNodeExpansion({
    data: {},
    id: "node-1",
    positionAbsoluteX: 24,
    positionAbsoluteY: 32,
    type: "container",
  });

  return (
    <button
      onClick={() => expansion.onExpandedChange(!expansion.expanded)}
      type="button"
    >
      {String(expansion.expanded)}
    </button>
  );
}

test("canvas node expansion mounts without a React Flow provider", async () => {
  const reactTestGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactTestGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: ReactTestRenderer | undefined;

  try {
    await act(() => {
      renderer = create(<ExpansionProbe />);
    });

    const button = renderer?.root.findByType("button");
    assert.deepEqual(button?.children, ["true"]);

    await act(() => {
      button?.props.onClick();
    });

    assert.deepEqual(button?.children, ["false"]);
  } finally {
    if (renderer !== undefined) {
      await act(() => {
        renderer?.unmount();
      });
    }
    reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
