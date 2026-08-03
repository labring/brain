import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@testing-library/react/pure";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import { BrainDeploymentStart } from "./brain-module-view";

test("deployment start tracks each closed-to-open transition", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const dataLayer: unknown[] = [];
  Object.assign(window, { dataLayer });
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(<BrainDeploymentStart open={false} />);
    });
    assert.deepEqual(dataLayer, []);

    await actAndDrain(() => {
      rendered?.rerender(<BrainDeploymentStart open />);
    });
    assert.equal(dataLayer.length, 1);

    await actAndDrain(() => {
      rendered?.rerender(<BrainDeploymentStart open />);
    });
    assert.equal(dataLayer.length, 1);

    await actAndDrain(() => {
      rendered?.rerender(<BrainDeploymentStart open={false} />);
    });
    await actAndDrain(() => {
      rendered?.rerender(<BrainDeploymentStart open />);
    });
    assert.equal(dataLayer.length, 2);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("deployment start tracks a creation pane opened by the initial URL", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const dataLayer: unknown[] = [];
  Object.assign(window, { dataLayer });
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(<BrainDeploymentStart open />);
    });
    assert.equal(dataLayer.length, 1);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});
