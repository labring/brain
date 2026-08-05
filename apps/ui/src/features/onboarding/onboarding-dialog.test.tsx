import assert from "node:assert/strict";
import { test } from "node:test";

import { AppDialog } from "@workspace/ui/components/app-dialog";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
  walkElements,
} from "@/features/project-canvas/react-test-harness";

import {
  OnboardingDialog,
  OnboardingSurveyCard,
  refuseOnboardingDialogClose,
} from "./onboarding-dialog";

const STEP_INDICATOR_RE = /Step 1 of 4/;
const STEP_TWO_INDICATOR_RE = /Step 2 of 4/;
const STEP_ONE_TITLE_RE = /Tell us a bit about you\./;

function bodyButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")] as HTMLButtonElement[];
}

function buttonByText(text: string): HTMLButtonElement {
  const button = bodyButtons().find(
    (candidate) => candidate.textContent?.trim() === text
  );
  assert.ok(button, `button "${text}" is rendered`);
  return button;
}

// The dialog primitive never renders in the test DOM (repo pattern: dialog
// shells are asserted structurally), so the shell's non-dismissible contract
// is pinned on the element tree: `open` is fully controlled, the only
// open-change handler is the documented no-op, and no close/cancel control
// exists — Skip inside the card is the only exit.
test("the sampling dialog shell refuses every close except Skip", () => {
  const tree = OnboardingDialog({
    onAnswerStep: () => undefined,
    onSkip: () => undefined,
    open: true,
  });
  const elements = [...walkElements(tree)];

  const root = elements.find((element) => element.type === AppDialog.Root);
  assert.ok(root, "the shared AppDialog.Root is used");
  const rootProps = root.props as {
    onOpenChange?: unknown;
    open?: unknown;
  };
  assert.equal(rootProps.open, true);
  assert.equal(rootProps.onOpenChange, refuseOnboardingDialogClose);
  // The handler ignores the close request entirely; with `open` controlled,
  // escape-key and outside-press therefore cannot close the dialog.
  assert.equal(refuseOnboardingDialogClose(), undefined);

  const content = elements.find(
    (element) => element.type === AppDialog.Content
  );
  assert.ok(content, "the shared AppDialog.Content is used");
  assert.equal((content.props as { size?: unknown }).size, "xl");

  assert.equal(
    elements.some((element) => element.type === AppDialog.Cancel),
    false,
    "no cancel/close control is mounted"
  );
});

test("Step 1 skips with the step number and gates Next on a selection", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  const skips: { dismissedAtStep: number }[] = [];
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(
        <OnboardingSurveyCard
          onAnswerStep={() => undefined}
          onSkip={(payload) => {
            skips.push(payload);
          }}
        />
      );
    });

    assert.match(document.body.textContent ?? "", STEP_INDICATOR_RE);
    assert.match(document.body.textContent ?? "", STEP_ONE_TITLE_RE);

    const next = bodyButtons().find((candidate) =>
      candidate.textContent?.includes("Next")
    );
    assert.ok(next, "the explicit Next button is rendered");
    assert.equal(next.disabled, true);

    await actAndDrain(() => {
      fireEvent.click(buttonByText("Individual developer"));
    });
    assert.equal(next.disabled, false);

    // Re-picking the selected option clears it and re-locks Next.
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Individual developer"));
    });
    assert.equal(next.disabled, true);

    assert.equal(document.querySelector("input"), null);
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    const otherInput = document.querySelector("input");
    assert.ok(otherInput, "selecting Other reveals the free-text input");
    // The Other text is optional: revealing it never blocks Next.
    assert.equal(next.disabled, false);

    await actAndDrain(() => {
      fireEvent.click(buttonByText("Skip"));
    });
    assert.deepEqual(skips, [{ dismissedAtStep: 1 }]);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("Next persists the role answer and advances to the Step 2 placeholder", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  const answers: unknown[] = [];
  const skips: { dismissedAtStep: number }[] = [];
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(
        <OnboardingSurveyCard
          onAnswerStep={(payload) => {
            answers.push(payload);
          }}
          onSkip={(payload) => {
            skips.push(payload);
          }}
        />
      );
    });

    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    const otherInput = document.querySelector("input");
    assert.ok(otherInput, "the Other input is revealed");
    await actAndDrain(() => {
      // A real focus (emitting focusin) plus a keyUp flush: React falls back
      // to keystroke polling for change detection when react-dom was first
      // loaded without a DOM, as happens mid-suite — fireEvent.change alone
      // is dropped there.
      otherInput.focus();
      fireEvent.input(otherInput, {
        target: { value: "  platform team lead " },
      });
      fireEvent.keyUp(otherInput, { key: "d" });
    });
    assert.equal(otherInput.value, "  platform team lead ");

    const next = bodyButtons().find((candidate) =>
      candidate.textContent?.includes("Next")
    );
    assert.ok(next, "the explicit Next button is rendered");
    await actAndDrain(() => {
      fireEvent.click(next);
    });

    // The write fires exactly once, at the moment of advancing, with the
    // normalized Other pair; the indicator moves to the real step.
    assert.deepEqual(answers, [
      { roleOtherText: "platform team lead", roleType: "other", step: 1 },
    ]);
    assert.match(document.body.textContent ?? "", STEP_TWO_INDICATOR_RE);
    assert.doesNotMatch(document.body.textContent ?? "", STEP_ONE_TITLE_RE);
    // The placeholder has nothing to answer, so Next is locked again.
    assert.equal(next.disabled, true);

    // Skip from the placeholder reports the real step.
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Skip"));
    });
    assert.deepEqual(skips, [{ dismissedAtStep: 2 }]);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});
