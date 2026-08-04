import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react/pure";
import { act, type ReactElement } from "react";

import {
  CanvasNodeCopyableRow,
  CanvasNodeCopyFeedbackScope,
} from "./canvas-node.copyable-row";

function installTestDom() {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register({ url: "https://copyable-row.test" });
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

function rowSection(container: HTMLElement) {
  return container.querySelector('[data-slot="canvas-node-copyable-row"]');
}

function rowHitArea(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    '[data-slot="canvas-node-copyable-row-hitarea"]'
  );
}

test("an in-flight on-demand copy marks the row busy and blocks re-entry", async () => {
  let resolveCopy = () => {
    /* replaced per copy */
  };
  let copyCalls = 0;
  const onCopy = () => {
    copyCalls += 1;
    return new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
  };

  await withMounted(
    <CanvasNodeCopyFeedbackScope>
      <CanvasNodeCopyableRow
        copyAriaLabel="Copy DSN"
        copyValue="masked-template"
        onCopy={onCopy}
        rowKey="dsn"
      >
        {({ busy }) => (
          <span data-probe-busy={busy ? "true" : "false"} data-slot="probe" />
        )}
      </CanvasNodeCopyableRow>
    </CanvasNodeCopyFeedbackScope>,
    async ({ container }) => {
      const hitArea = rowHitArea(container);
      assert.ok(hitArea, "hit-area should render");

      await act(() => {
        hitArea.click();
        hitArea.click();
      });
      assert.equal(copyCalls, 1, "re-entry must not start a second copy");

      const section = rowSection(container);
      assert.equal(section?.getAttribute("data-busy"), "true");
      assert.equal(
        container
          .querySelector('[data-slot="probe"]')
          ?.getAttribute("data-probe-busy"),
        "true"
      );
      assert.equal(section?.getAttribute("data-copied"), null);

      await act(async () => {
        resolveCopy();
        await Promise.resolve();
      });
      assert.equal(rowSection(container)?.getAttribute("data-busy"), null);
      assert.equal(rowSection(container)?.getAttribute("data-copied"), "true");
    }
  );
});

test("a rejected on-demand copy returns the row to rest without copied feedback", async () => {
  let rejectCopy = () => {
    /* replaced per copy */
  };
  const onCopy = () =>
    new Promise<void>((_resolve, reject) => {
      rejectCopy = () => reject(new Error("fetch failed"));
    });

  await withMounted(
    <CanvasNodeCopyFeedbackScope>
      <CanvasNodeCopyableRow
        copyAriaLabel="Copy DSN"
        copyValue="masked-template"
        onCopy={onCopy}
        rowKey="dsn"
      />
    </CanvasNodeCopyFeedbackScope>,
    async ({ container }) => {
      const hitArea = rowHitArea(container);
      assert.ok(hitArea, "hit-area should render");

      await act(() => {
        hitArea.click();
      });
      assert.equal(rowSection(container)?.getAttribute("data-busy"), "true");

      await act(async () => {
        rejectCopy();
        await Promise.resolve();
      });
      assert.equal(rowSection(container)?.getAttribute("data-busy"), null);
      assert.equal(
        rowSection(container)?.getAttribute("data-copied"),
        null,
        "a failed copy must not read as copied"
      );
    }
  );
});
