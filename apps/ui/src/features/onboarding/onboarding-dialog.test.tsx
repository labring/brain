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
const STEP_FOUR_TITLE_RE = /Anything specific you're trying to achieve\?/;
const OTHER_REQUIRED_RE = /This field is required\./;

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

/** Clicks the explicit Next button, asserting it is rendered. */
async function clickNext(): Promise<void> {
  // Imported lazily like every DOM library here: the module may only load
  // after installTestDom has put a document in place.
  const { fireEvent } = await import("@testing-library/dom");
  const next = bodyButtons().find((candidate) =>
    candidate.textContent?.includes("Next")
  );
  assert.ok(next, "the explicit Next button is rendered");
  await actAndDrain(() => {
    fireEvent.click(next);
  });
}

// The dialog primitive cannot render in this suite: Base UI picks its
// layout-effect shim at module load (`@base-ui/utils` `useIsoLayoutEffect`:
// `typeof document !== 'undefined' ? React.useLayoutEffect : noop`), and
// test files import the dialog chain before any suite-local DOM registers,
// so the portal never mounts (repo pattern: dialog shells are asserted
// structurally). The non-dismissible contract is therefore pinned
// on the element tree: `open` is fully controlled, the only open-change
// handler is the documented no-op, and no close/cancel control exists —
// Skip inside the card is the only exit.
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
    assert.ok(otherInput, "selecting Other morphs the card into an input");
    // Empty Other keeps Next clickable — the click surfaces the inline
    // required error instead of disabling the button (pinned below).
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

test("an empty Other refuses Next with the inline error until text arrives", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  const answers: unknown[] = [];
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(
        <OnboardingSurveyCard
          onAnswerStep={(payload) => {
            answers.push(payload);
          }}
          onComplete={() => undefined}
          onSkip={() => undefined}
        />
      );
    });

    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    assert.doesNotMatch(document.body.textContent ?? "", OTHER_REQUIRED_RE);

    // Next with no text: the error appears, nothing advances or persists.
    await clickNext();
    assert.match(document.body.textContent ?? "", OTHER_REQUIRED_RE);
    assert.match(document.body.textContent ?? "", STEP_INDICATOR_RE);
    assert.equal(answers.length, 0);

    // Typing clears the error display without another Next.
    const otherInput = document.querySelector("input");
    assert.ok(otherInput, "the morphed Other input is rendered");
    await actAndDrain(() => {
      otherInput.focus();
      fireEvent.input(otherInput, { target: { value: "SRE" } });
      fireEvent.keyUp(otherInput, { key: "d" });
    });
    assert.doesNotMatch(document.body.textContent ?? "", OTHER_REQUIRED_RE);

    // The glyph inside the morphed field unselects Other, restoring the card.
    const unselect = bodyButtons().find(
      (candidate) => candidate.getAttribute("aria-label") === "Unselect Other"
    );
    assert.ok(unselect, "the morphed field keeps the selection glyph");
    await actAndDrain(() => {
      fireEvent.click(unselect);
    });
    assert.equal(document.querySelector("input"), null);
    assert.ok(buttonByText("Other"), "the Other card is restored");

    // With text in place, Next advances and the trimmed pair persists.
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    const revived = document.querySelector("input");
    assert.ok(revived, "re-selecting Other morphs the card again");
    // The Other text survives the unselect round-trip by design.
    await clickNext();
    assert.deepEqual(answers, [
      { roleOtherText: "SRE", roleType: "other", step: 1 },
    ]);
    assert.match(document.body.textContent ?? "", STEP_TWO_INDICATOR_RE);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("the morphed Other input claims focus on select, wrapper press, and refused Next", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(
        <OnboardingSurveyCard
          onAnswerStep={() => undefined}
          onComplete={() => undefined}
          onSkip={() => undefined}
        />
      );
    });

    // Selecting Other focuses the revealed input — typing starts without a
    // second click.
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Other"));
    });
    const otherInput = document.querySelector("input");
    assert.ok(otherInput, "the morphed Other input is rendered");
    assert.equal(document.activeElement, otherInput);

    // The field wrapper's padding belongs to the input's hit area: a pointer
    // press anywhere on it (outside the glyph) focuses the input.
    await actAndDrain(() => {
      otherInput.blur();
    });
    assert.notEqual(document.activeElement, otherInput);
    const wrapper = otherInput.parentElement;
    assert.ok(wrapper, "the input sits in the field wrapper");
    await actAndDrain(() => {
      fireEvent.pointerDown(wrapper);
    });
    assert.equal(document.activeElement, otherInput);

    // A refused Next surfaces the error and sends focus into the empty field.
    await actAndDrain(() => {
      otherInput.blur();
    });
    await clickNext();
    assert.match(document.body.textContent ?? "", OTHER_REQUIRED_RE);
    assert.equal(document.activeElement, otherInput);
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

/**
 * The exact dataLayer entry a funnel event lands as: the event name, the
 * shared context/module envelope, and — for view/skip — the bare step
 * number. deepEqual on these pins the privacy rule observably: no answer
 * value, free text, or user ID rides along.
 */
function funnelEntry(event: string, step?: number) {
  return {
    context: "app",
    event,
    module: "brain",
    ...(step === undefined ? {} : { step }),
  };
}

test("the funnel emits one view per step shown and complete at submit time", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  const dataLayer: unknown[] = [];
  Object.assign(window, { dataLayer });
  const completes: unknown[] = [];
  let rendered: ReturnType<typeof render> | undefined;

  try {
    await actAndDrain(() => {
      rendered = render(
        <OnboardingSurveyCard
          onAnswerStep={() => undefined}
          onComplete={(payload) => {
            completes.push(payload);
          }}
          onSkip={() => undefined}
        />
      );
    });

    // The dialog's appearance is the step 1 view.
    assert.deepEqual(dataLayer, [funnelEntry("onboarding_step_view", 1)]);

    // Interaction within a step re-renders without re-viewing it.
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Individual developer"));
    });
    assert.deepEqual(dataLayer, [funnelEntry("onboarding_step_view", 1)]);

    await clickNext();
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Just exploring Sealos"));
    });
    await clickNext();
    await actAndDrain(() => {
      fireEvent.click(optionButton("Stability"));
    });
    await clickNext();
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Submit & Enter Console"));
    });

    // The whole flow, exactly: four views in order, then the completion.
    assert.deepEqual(dataLayer, [
      funnelEntry("onboarding_step_view", 1),
      funnelEntry("onboarding_step_view", 2),
      funnelEntry("onboarding_step_view", 3),
      funnelEntry("onboarding_step_view", 4),
      funnelEntry("onboarding_complete"),
    ]);
    // The event fired at click time and the owner's callback still ran.
    assert.deepEqual(completes, [{ openGoalText: null }]);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("Skip fires the funnel event with the step it left from", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  const dataLayer: unknown[] = [];
  Object.assign(window, { dataLayer });
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

    await actAndDrain(() => {
      fireEvent.click(buttonByText("Individual developer"));
    });
    await clickNext();
    await actAndDrain(() => {
      fireEvent.click(buttonByText("Skip"));
    });

    assert.deepEqual(dataLayer, [
      funnelEntry("onboarding_step_view", 1),
      funnelEntry("onboarding_step_view", 2),
      funnelEntry("onboarding_skip", 2),
    ]);
    // The event fired at click time and the owner's dismiss still ran.
    assert.deepEqual(skips, [{ dismissedAtStep: 2 }]);
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("a broken dataLayer never touches the survey flow", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const { render } = await import("@testing-library/react/pure");
  const { fireEvent } = await import("@testing-library/dom");
  // Analytics is best-effort: every push throws, nothing may escape.
  Object.assign(window, {
    dataLayer: {
      push: () => {
        throw new Error("transport failed");
      },
    },
  });
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
          onComplete={() => undefined}
          onSkip={(payload) => {
            skips.push(payload);
          }}
        />
      );
    });

    await actAndDrain(() => {
      fireEvent.click(buttonByText("Individual developer"));
    });
    await clickNext();

    // The survey advanced and persisted as if analytics did not exist.
    assert.match(document.body.textContent ?? "", STEP_TWO_INDICATOR_RE);
    assert.equal(answers.length, 1);

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
