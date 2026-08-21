/**
 * Segmented pill follows the active option after click. Happy-dom has no
 * layout, so button offsetLeft/offsetWidth are stubbed before the click.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { useState } from "react";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "./test/harness";

const LAYOUT = {
  Off: { left: 2, width: 40 },
  On: { left: 42, width: 36 },
} as const;

function stubSegmentLayout(): void {
  for (const button of document.querySelectorAll(
    ".dev-tweaks-segmented-button"
  )) {
    const label = button.textContent;
    const layout =
      label === "On" || label === "Off" ? LAYOUT[label] : undefined;
    if (!layout) {
      continue;
    }
    Object.defineProperty(button, "offsetLeft", {
      configurable: true,
      get: () => layout.left,
    });
    Object.defineProperty(button, "offsetWidth", {
      configurable: true,
      get: () => layout.width,
    });
  }
}

function pillBox(): { left: string; width: string } {
  const pill = document.querySelector(
    ".dev-tweaks-segmented-pill"
  ) as HTMLElement | null;
  assert.ok(pill, "pill should be mounted after measure");
  return { left: pill.style.left, width: pill.style.width };
}

function activeLabel(): string | null {
  return (
    document.querySelector('.dev-tweaks-segmented-button[data-active="true"]')
      ?.textContent ?? null
  );
}

test("segmented pill slides to the clicked Off/On option", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { SegmentedControl } = await import(
      "./panel/components/segmented-control"
    );
    const { cleanup, render, within } = await import(
      "@testing-library/react/pure"
    );
    const body = () => within(document.body);

    function Harness() {
      const [value, setValue] = useState<"off" | "on">("off");
      return (
        <SegmentedControl
          onChange={setValue}
          options={[
            { label: "Off", value: "off" as const },
            { label: "On", value: "on" as const },
          ]}
          value={value}
        />
      );
    }

    await actAndDrain(() => {
      render(<Harness />);
    });
    stubSegmentLayout();

    await actAndDrain(() => {
      body().getByText("On").click();
    });
    assert.equal(activeLabel(), "On");
    assert.deepEqual(pillBox(), { left: "42px", width: "36px" });

    await actAndDrain(() => {
      body().getByText("Off").click();
    });
    assert.equal(activeLabel(), "Off");
    assert.deepEqual(pillBox(), { left: "2px", width: "40px" });

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});
