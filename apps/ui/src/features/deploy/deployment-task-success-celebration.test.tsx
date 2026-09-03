import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import {
  claimDeploymentTaskSuccessCelebration,
  deploymentTaskSuccessCelebrationKey,
  hasDeploymentTaskSuccessCelebrationClaim,
  resetDeploymentTaskSuccessCelebrationClaims,
  useDeploymentTaskSuccessCelebration,
} from "./deployment-task-success-celebration";

// Short enough to keep the suite quick, long enough that a settle has to outlast
// the whole window before it can be observed closing.
const TEST_CELEBRATION_MS = 25;
const SETTLE_MS = 120;

function CelebrationProbe({
  onCelebrated,
  revision,
  taskId,
}: {
  onCelebrated: () => void;
  revision: number | null;
  taskId: string;
}) {
  const celebrating = useDeploymentTaskSuccessCelebration({
    celebrationMs: TEST_CELEBRATION_MS,
    onCelebrated,
    successRevision: revision,
    taskId,
  });
  return <span data-celebrating={celebrating ? "true" : "false"} />;
}

interface Harness {
  celebrate: () => number;
  claimFor: (revision: number, taskId?: string) => boolean;
  container: HTMLElement;
  rerender: (revision: number | null) => Promise<void>;
  settle: () => Promise<void>;
}

function isCelebrating(container: HTMLElement): boolean {
  return container.querySelector('[data-celebrating="true"]') !== null;
}

/** One scenario, a fresh DOM and an empty set of page-session claims. */
async function withCelebrationHarness(
  /** What the Timeline shows the moment the pane mounts. */
  initialRevision: number | null,
  run: (harness: Harness) => Promise<void>
): Promise<void> {
  resetDeploymentTaskSuccessCelebrationClaims();
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  let celebrated = 0;
  let rendered: ReturnType<typeof render> | undefined;
  try {
    const show = async (revision: number | null) => {
      await actAndDrain(() => {
        const element = (
          <CelebrationProbe
            onCelebrated={() => {
              celebrated += 1;
            }}
            revision={revision}
            taskId="task-1"
          />
        );
        if (rendered == null) {
          rendered = render(element);
        } else {
          rendered.rerender(element);
        }
      });
    };
    // A pane opened on a running task starts with no conclusion at all; a pane
    // opened after a refresh starts with the conclusion already in place.
    await show(initialRevision);
    const container = rendered?.container;
    assert.ok(container);
    await run({
      celebrate: () => celebrated,
      container,
      claimFor: (revision, taskId = "task-1") =>
        hasDeploymentTaskSuccessCelebrationClaim(
          deploymentTaskSuccessCelebrationKey(taskId, revision)
        ),
      rerender: show,
      settle: async () => {
        await actAndDrain(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, SETTLE_MS);
          });
        }, SETTLE_MS);
      },
    });
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
    resetDeploymentTaskSuccessCelebrationClaims();
  }
}

test("a success revision is claimed exactly once per page session", () => {
  resetDeploymentTaskSuccessCelebrationClaims();
  const key = deploymentTaskSuccessCelebrationKey("task-1", 4);
  assert.equal(key, "task-1:4");
  assert.equal(hasDeploymentTaskSuccessCelebrationClaim(key), false);
  assert.equal(claimDeploymentTaskSuccessCelebration(key), true);
  assert.equal(claimDeploymentTaskSuccessCelebration(key), false);
  assert.equal(hasDeploymentTaskSuccessCelebrationClaim(key), true);
  resetDeploymentTaskSuccessCelebrationClaims();
  assert.equal(hasDeploymentTaskSuccessCelebrationClaim(key), false);
});

test("opening a task that already succeeded does not celebrate", async () => {
  await withCelebrationHarness(
    7,
    async ({ celebrate, claimFor, container }) => {
      // A refresh lands straight on the finished snapshot: the user did not
      // watch anything change, so the party is skipped and the panel stays put.
      assert.equal(isCelebrating(container), false);
      await new Promise((resolve) => {
        setTimeout(resolve, SETTLE_MS);
      });
      assert.equal(celebrate(), 0);
      assert.equal(claimFor(7), false);
    }
  );
});

test("a live success celebrates once and then hands the panel back", async () => {
  await withCelebrationHarness(
    null,
    async ({ celebrate, claimFor, container, rerender, settle }) => {
      await rerender(5);
      assert.equal(isCelebrating(container), true);
      assert.equal(claimFor(5), true);
      assert.equal(celebrate(), 0);

      // Stream ticks keep arriving after the transition, including a frame that
      // is no different from the last; none of them may reopen the window.
      await rerender(5);
      await rerender(5);
      await settle();
      assert.equal(isCelebrating(container), false);
      assert.equal(celebrate(), 1);

      // Reconnecting through a running frame and back to the same conclusion is
      // still the same conclusion, so it stays silent.
      await rerender(null);
      await rerender(5);
      await settle();
      assert.equal(isCelebrating(container), false);
      assert.equal(celebrate(), 1);
    }
  );
});

test("a new conclusion on the same task celebrates again", async () => {
  await withCelebrationHarness(
    null,
    async ({ celebrate, claimFor, container, rerender, settle }) => {
      await rerender(5);
      await settle();
      assert.equal(celebrate(), 1);

      await rerender(6);
      assert.equal(isCelebrating(container), true);
      await settle();
      assert.equal(celebrate(), 2);
      assert.equal(claimFor(5), true);
      assert.equal(claimFor(6), true);
    }
  );
});

test("claims are scoped to one task, not to every Timeline", async () => {
  await withCelebrationHarness(
    null,
    async ({ celebrate, claimFor, rerender, settle }) => {
      await rerender(5);
      await settle();
      assert.equal(celebrate(), 1);
      assert.equal(claimFor(5), true);
      assert.equal(claimFor(5, "task-2"), false);
      assert.equal(claimFor(5, "task-1"), true);
    }
  );
});
