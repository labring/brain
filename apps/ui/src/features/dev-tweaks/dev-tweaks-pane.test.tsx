import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";

import { devTweaksStore } from "./dev-tweaks-store";

// Dialog content sits at z-[51] and select popups at z-[52], both portaled
// to <body> (packages/ui dialog.tsx / app-select.tsx). The pane must clear
// that whole band, or a modal that only the pane can switch off (e.g. the
// onboarding forceModal knob) buries its own off switch.
const POPUP_BAND_TOP = 52;

const Z_LAYER_RE = /z-\[(\d+)\]/;

test("the pane portals to <body> and stacks above the popup band", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { DevTweaksPane } = await import("./dev-tweaks-pane");
  let rendered: ReturnType<typeof render> | undefined;

  try {
    devTweaksStore.setOpen(true);
    await actAndDrain(() => {
      rendered = render(
        <div id="deep-app-shell">
          <DevTweaksPane />
        </div>
      );
    });

    const pane = document.querySelector('aside[aria-label="Dev tweaks"]');
    assert.ok(pane, "the pane is rendered while the store is open");
    assert.equal(
      pane.parentElement,
      document.body,
      "the pane escapes the app tree via a body portal, so later-mounted popup portals cannot bury it by DOM order"
    );

    const zMatch = Z_LAYER_RE.exec(pane.className);
    assert.ok(
      zMatch,
      `the pane carries an explicit z layer: ${pane.className}`
    );
    assert.ok(
      Number(zMatch[1]) > POPUP_BAND_TOP,
      `the pane's z layer (${zMatch[1]}) clears the popup band (dialogs 51, selects 52)`
    );
  } finally {
    await actAndDrain(() => {
      devTweaksStore.setOpen(false);
    });
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});
