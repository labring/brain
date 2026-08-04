import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react/pure";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppIconButton } from "./app-icon-button";

const ARIA_BUSY_RE = /aria-busy="true"/;
const DATA_BUSY_RE = /data-busy="true"/;
const DISABLED_ATTRIBUTE_RE = / disabled="/;
const ICON_RE = /data-slot="test-icon"/;
const SPINNER_DELAY_SETTLE_MS = 200;

function installTestDom() {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register({ url: "https://app-icon-button.test" });
  return () => GlobalRegistrator.unregister();
}

async function withMounted(
  element: ReactElement,
  run: (rendered: ReturnType<typeof render>) => Promise<void> | void
) {
  const restoreDom = installTestDom();
  const reactTestGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactTestGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await act(() => {
      rendered = render(element);
    });
    assert.ok(rendered);
    await run(rendered);
  } finally {
    if (rendered) {
      await act(() => {
        rendered?.unmount();
      });
    }
    reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    await restoreDom();
  }
}

test("busy marks the button without disabling it and keeps the icon before the threshold", () => {
  const html = renderToStaticMarkup(
    <AppIconButton aria-label="Copy value" busy>
      <span data-slot="test-icon" />
    </AppIconButton>
  );

  assert.match(html, ARIA_BUSY_RE);
  assert.match(html, DATA_BUSY_RE);
  assert.match(html, ICON_RE);
  assert.doesNotMatch(html, DISABLED_ATTRIBUTE_RE);
});

test("a rest button carries no busy markup", () => {
  const html = renderToStaticMarkup(
    <AppIconButton aria-label="Copy value">
      <span data-slot="test-icon" />
    </AppIconButton>
  );

  assert.doesNotMatch(html, ARIA_BUSY_RE);
  assert.doesNotMatch(html, DATA_BUSY_RE);
});

test("busy ignores clicks and swaps the icon for a spinner after the threshold", async () => {
  let clicks = 0;
  await withMounted(
    <AppIconButton
      aria-label="Copy value"
      busy
      onClick={() => {
        clicks += 1;
      }}
    >
      <span data-slot="test-icon" />
    </AppIconButton>,
    async ({ container }) => {
      const button = container.querySelector("button");
      assert.ok(button, "button should render");

      await act(() => {
        button.click();
      });
      assert.equal(clicks, 0, "busy button must ignore clicks");

      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, SPINNER_DELAY_SETTLE_MS)
        );
      });
      assert.ok(
        button.querySelector('[role="status"]'),
        "spinner should appear after the threshold"
      );
      assert.equal(
        button.querySelector('[data-slot="test-icon"]'),
        null,
        "icon should yield to the spinner"
      );
    }
  );
});

test("a rest button fires clicks and never shows the spinner", async () => {
  let clicks = 0;
  await withMounted(
    <AppIconButton
      aria-label="Copy value"
      onClick={() => {
        clicks += 1;
      }}
    >
      <span data-slot="test-icon" />
    </AppIconButton>,
    async ({ container }) => {
      const button = container.querySelector("button");
      assert.ok(button, "button should render");

      await act(() => {
        button.click();
      });
      assert.equal(clicks, 1);

      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, SPINNER_DELAY_SETTLE_MS)
        );
      });
      assert.equal(button.querySelector('[role="status"]'), null);
      assert.ok(button.querySelector('[data-slot="test-icon"]'));
    }
  );
});
