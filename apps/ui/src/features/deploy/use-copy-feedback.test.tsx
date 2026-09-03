import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render } from "@testing-library/react/pure";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import { useCopyFeedback } from "./use-copy-feedback";

// Short enough to keep the suite quick, long enough that a premature revert
// cannot slip past the assertion. The production default is a reading window
// (COPY_FEEDBACK_MS), not a behavior under test.
const TEST_FEEDBACK_MS = 200;

function CopyProbe({ text }: { text: string }) {
  const [copied, copy] = useCopyFeedback(text, TEST_FEEDBACK_MS);
  return (
    <button onClick={copy} type="button">
      {copied ? "copied" : "copy"}
    </button>
  );
}

function stubClipboard(input: { onWrite: (text: string) => Promise<void> }) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: input.onWrite },
  });
}

function control(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector("button");
  assert.ok(button);
  return button as HTMLButtonElement;
}

test("the check mark waits for the write and reverts on its own", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const written: string[] = [];
  let accept: () => void = () => {
    assert.fail("the clipboard promise was settled twice");
  };
  stubClipboard({
    onWrite: (text) =>
      new Promise<void>((resolve) => {
        written.push(text);
        accept = resolve;
      }),
  });
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(<CopyProbe text="task-abc123" />);
    });
    const container = rendered?.container;
    assert.ok(container);
    assert.equal(container.textContent, "copy");

    // Accepted by the browser? Not yet, so the control must not claim it was.
    await actAndDrain(() => {
      fireEvent.click(control(container));
    }, 0);
    assert.deepEqual(written, ["task-abc123"]);
    assert.equal(container.textContent, "copy");

    await actAndDrain(() => {
      accept();
    });
    assert.equal(container.textContent, "copied");

    // The window closes by itself: a stale check mark would keep claiming a
    // copy the user stopped looking at.
    await actAndDrain(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, TEST_FEEDBACK_MS + 50);
      });
    }, 0);
    assert.equal(container.textContent, "copy");
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("a page without a clipboard never claims a copy", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  stubClipboard({ onWrite: () => Promise.resolve() });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(<CopyProbe text="https://demo.sealos.run" />);
    });
    const container = rendered?.container;
    assert.ok(container);

    // An insecure context or a denied permission is a normal state of the web;
    // the control has to survive the click without lying about it.
    await actAndDrain(() => {
      fireEvent.click(control(container));
    });
    assert.equal(container.textContent, "copy");
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});
