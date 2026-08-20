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
