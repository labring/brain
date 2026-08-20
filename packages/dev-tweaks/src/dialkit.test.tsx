/**
 * Integration coverage for the DialKit surface through the package
 * entry: hook value resolution, store → hook subscription, DialRoot panel
 * rendering, and the package's own cssVarOverrides bridge.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialConfig } from "./dialkit/store/dial-store";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "./test/harness";

// DialKit tuples are mutable, so `satisfies` (not `as const`) keeps the
// config assignable while preserving inference for ResolvedValues.
const CARD_CONFIG = {
  blur: [24, 0, 100, 1],
  enabled: true,
  scale: 1.2,
  tint: "#ff5500",
} satisfies DialConfig;

test("useDialKit resolves defaults and reflects store updates", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DialStore, useDialKit } = await import("./index");
    const { cleanup, render, within } = await import(
      "@testing-library/react/pure"
    );
    // `screen` binds the first registered DOM for the whole process — rebind
    // queries to this test's document instead.
    const body = () => within(document.body);

    function Probe() {
      const values = useDialKit("Card", CARD_CONFIG, { id: "test-card" });
      return <output data-testid="values">{JSON.stringify(values)}</output>;
    }

    await actAndDrain(() => {
      render(<Probe />);
    });
    assert.deepEqual(
      JSON.parse(body().getByTestId("values").textContent ?? ""),
      { blur: 24, enabled: true, scale: 1.2, tint: "#ff5500" }
    );

    await actAndDrain(() => {
      DialStore.updateValue("test-card", "blur", 42);
    });
    assert.equal(
      (
        JSON.parse(body().getByTestId("values").textContent ?? "") as {
          blur: number;
        }
      ).blur,
      42
    );

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

test("DialRoot renders a registered panel", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DialRoot, useDialKit } = await import("./index");
    const { cleanup, render, within } = await import(
      "@testing-library/react/pure"
    );

    function Probe() {
      useDialKit("Card", CARD_CONFIG, { id: "test-card-panel" });
      return null;
    }

    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DialRoot productionEnabled />
        </>
      );
    });
    assert.ok(within(document.body).getByText("Card"));

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

function pressToggleHotkey() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      altKey: true,
      cancelable: true,
      code: "KeyT",
      ctrlKey: true,
    })
  );
}

test("⌃⌥T toggles the panel, and frame posture insets the document", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DialRoot, useDialKit } = await import("./index");
    const { cleanup, render } = await import("@testing-library/react/pure");

    function Probe() {
      useDialKit("Card", CARD_CONFIG, { id: "test-card-hotkey" });
      return null;
    }

    const collapsed = () =>
      document
        .querySelector(".dialkit-panel-inner")
        ?.getAttribute("data-collapsed");
    const framed = () =>
      document.documentElement.classList.contains("dialkit-framed");

    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DialRoot defaultOpen={false} productionEnabled />
        </>
      );
    });
    assert.equal(collapsed(), "true");
    assert.equal(framed(), false);
    assert.ok(
      document.documentElement.classList.contains("dialkit-frame-host")
    );

    await actAndDrain(() => {
      pressToggleHotkey();
    });
    assert.equal(collapsed(), "false");
    assert.equal(framed(), true, "open panel docks the page (frame default)");

    await actAndDrain(() => {
      pressToggleHotkey();
    });
    assert.equal(collapsed(), "true");
    assert.equal(framed(), false);

    await actAndDrain(() => {
      cleanup();
    });
    assert.equal(
      document.documentElement.classList.contains("dialkit-frame-host"),
      false,
      "unmount leaves nothing behind"
    );
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

test("dirty-only launcher hides the closed bubble until a value deviates", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DialRoot, DialStore, useDialKit } = await import("./index");
    const { cleanup, render } = await import("@testing-library/react/pure");

    function Probe() {
      useDialKit("Card", CARD_CONFIG, { id: "test-card-dirty" });
      return null;
    }

    const panelDisplay = () =>
      (document.querySelector(".dialkit-panel") as HTMLElement | null)?.style
        .display;

    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DialRoot defaultOpen={false} launcher="dirty" productionEnabled />
        </>
      );
    });
    assert.equal(panelDisplay(), "none", "clean and closed → no chrome");

    await actAndDrain(() => {
      DialStore.updateValue("test-card-dirty", "blur", 42);
    });
    assert.notEqual(panelDisplay(), "none", "override lights the bubble");

    await actAndDrain(() => {
      DialStore.resetValues("test-card-dirty");
    });
    assert.equal(panelDisplay(), "none", "reset hides it again");

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

test("cssVarOverrides writes only overridden values, with units", async () => {
  const { cssVarOverrides } = await import("./css-vars");
  const style = cssVarOverrides(
    CARD_CONFIG,
    { blur: 42, enabled: true, scale: 1.2, tint: "#ff5500" },
    {
      blur: { cssVar: "--card-blur", unit: "px" },
      scale: { cssVar: "--card-scale" },
      tint: { cssVar: "--card-tint" },
    }
  );
  assert.deepEqual(style, { "--card-blur": "42px" });
});
