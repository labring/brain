import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render } from "@testing-library/react/pure";
import { act } from "react";

import { installTestDom } from "@/features/project-canvas/react-test-harness";

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
  const dom = installTestDom();
  const reactTestGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactTestGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await act(() => {
      rendered = render(<ExpansionProbe />);
    });

    const button = rendered?.getByRole("button");
    assert.equal(button?.textContent, "true");

    await act(() => {
      if (button !== undefined) {
        fireEvent.click(button);
      }
    });

    assert.equal(button?.textContent, "false");
  } finally {
    if (rendered !== undefined) {
      await act(() => {
        rendered?.unmount();
      });
    }
    reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    await dom.restore();
  }
});
