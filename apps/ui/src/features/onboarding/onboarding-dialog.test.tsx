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
const STEP_THREE_INDICATOR_RE = /Step 3 of 4/;
const STEP_FOUR_INDICATOR_RE = /Step 4 of 4/;
const STEP_ONE_TITLE_RE = /Tell us a bit about you\./;
const STEP_TWO_TITLE_RE = /What are you using Sealos for\?/;
const STEP_THREE_SUBTITLE_RE = /Choose up to 3\./;
const STEP_FOUR_TITLE_RE = /Anything specific you’re trying to achieve\?/;

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

/** Option cards prefix their text with the label ("Stability: I need…"). */
function optionButton(label: string): HTMLButtonElement {
  const button = bodyButtons().find((candidate) =>
    candidate.textContent?.trim().startsWith(label)
  );
  assert.ok(button, `option "${label}" is rendered`);
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
    onComplete: () => undefined,
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
          onComplete={() => undefined}
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

test("the survey walks Steps 1-4, persists each advance, and submits terminally", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  const answers: unknown[] = [];
  const completes: unknown[] = [];
  let rendered: ReturnType<typeof render> | undefined;

  const typeInto = async (input: HTMLInputElement, value: string) => {
    await actAndDrain(() => {
      // A real focus (emitting focusin) plus a keyUp flush: React falls back
      // to keystroke polling for change detection when react-dom was first
      // loaded without a DOM, as happens mid-suite — fireEvent.change alone
      // is dropped there.
      input.focus();
      fireEvent.input(input, { target: { value } });
      fireEvent.keyUp(input, { key: "d" });
    });
  };
  const clickNext = async () => {
    const next = bodyButtons().find((candidate) =>
      candidate.textContent?.includes("Next")
    );
    assert.ok(next, "the explicit Next button is rendered");
    await actAndDrain(() => {
      fireEvent.click(next);
    });
  };

  try {
    await actAndDrain(() => {
      rendered = render(
        <OnboardingSurveyCard
          onAnswerStep={(payload) => {
            answers.push(payload);
          }}
          onComplete={(payload) => {
            completes.push(payload);
          }}
          onSkip={() => undefined}
        />
      );
    });

    // Step 1: the Other pair persists at the moment Next advances.
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    const roleInput = document.querySelector("input");
    assert.ok(roleInput, "the Other input is revealed");
    await typeInto(roleInput, "  platform team lead ");
    await clickNext();
    assert.deepEqual(answers, [
      { roleOtherText: "platform team lead", roleType: "other", step: 1 },
    ]);
    assert.match(document.body.textContent ?? "", STEP_TWO_INDICATOR_RE);
    assert.doesNotMatch(document.body.textContent ?? "", STEP_ONE_TITLE_RE);

    // Step 2: single-select usage context.
    assert.match(document.body.textContent ?? "", STEP_TWO_TITLE_RE);
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Running a real business project"));
    });
    await clickNext();
    assert.deepEqual(answers.at(-1), {
      step: 2,
      usageContext: "real_business",
      usageOtherText: null,
    });
    assert.match(document.body.textContent ?? "", STEP_THREE_INDICATOR_RE);

    // Step 3: multi-select capped at 3, Other pinned last with optional text.
    assert.match(document.body.textContent ?? "", STEP_THREE_SUBTITLE_RE);
    await actAndDrain(() => {
      fireEvent.click(optionButton("Stability"));
    });
    await actAndDrain(() => {
      fireEvent.click(optionButton("Low cost"));
    });
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    // The cap is 3: every unselected option is locked out.
    assert.equal(optionButton("Performance").disabled, true);
    const priorityInput = document.querySelector("input");
    assert.ok(priorityInput, "the Step 3 Other input is revealed");
    await typeInto(priorityInput, " fair pricing ");
    await clickNext();
    // assert.deepEqual's assertion signature narrowed `answers` to the Step 1
    // payload shape above, so the cast has to travel through unknown.
    const priorityAnswer = answers.at(-1) as unknown as {
      priorityDisplayOrder: string[];
      priorityOtherText: string | null;
      priorityTags: string[];
      step: number;
    };
    // Array order = click order; the shuffled display order is captured
    // alongside, all seven tags with Other pinned last.
    assert.deepEqual(priorityAnswer.priorityTags, [
      "stability",
      "low_cost",
      "other",
    ]);
    assert.equal(priorityAnswer.priorityOtherText, "fair pricing");
    assert.equal(priorityAnswer.step, 3);
    assert.equal(priorityAnswer.priorityDisplayOrder.length, 7);
    assert.equal(priorityAnswer.priorityDisplayOrder.at(-1), "other");
    assert.match(document.body.textContent ?? "", STEP_FOUR_INDICATOR_RE);

    // Step 4: the open goal is optional; submit fires the terminal payload.
    assert.match(document.body.textContent ?? "", STEP_FOUR_TITLE_RE);
    const goalInput = document.querySelector("input");
    assert.ok(goalInput, "the open goal input is rendered");
    await typeInto(goalInput, " test a product idea ");
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Submit & Enter Console"));
    });
    assert.deepEqual(completes, [{ openGoalText: "test a product idea" }]);
    assert.equal(answers.length, 3, "submit is terminal, not a step write");
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});
