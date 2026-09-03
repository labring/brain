import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import {
  actAndDrain,
  defineGlobal,
  installTestDom,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import {
  DeploymentTaskSuccessConfetti,
  fireTimelineSuccessConfetti,
  prefersReducedMotion,
  type TimelineConfettiLoader,
  type TimelineConfettiShot,
} from "./deployment-task-success-confetti";

const CONFETTI_SLOT_RE = /data-slot="deployment-task-success-confetti"/;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface Recorder {
  load: TimelineConfettiLoader;
  resets: number;
  shots: TimelineConfettiShot[];
  targets: HTMLCanvasElement[];
}

/** Stands in for canvas-confetti so a test can count what was drawn. */
function recorder(): Recorder {
  const state: Recorder = {
    load: async () => (canvas: HTMLCanvasElement) => {
      state.targets.push(canvas);
      return Object.assign(
        (shot: TimelineConfettiShot) => {
          state.shots.push(shot);
          return Promise.resolve();
        },
        {
          reset: () => {
            state.resets += 1;
          },
        }
      );
    },
    resets: 0,
    shots: [],
    targets: [],
  };
  return state;
}

function newCanvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

/** Reports one motion preference for the lifetime of a test. */
function stubReducedMotion(matches: boolean) {
  const calls: string[] = [];
  const override = defineGlobal("matchMedia", (query: string) => {
    calls.push(query);
    return { matches };
  });
  return { calls, restore: () => restoreGlobal(override) };
}

test("reduced motion is read from the browser preference", () => {
  const enabled = stubReducedMotion(true);
  try {
    assert.equal(prefersReducedMotion(), true);
    assert.deepEqual(enabled.calls, [REDUCED_MOTION_QUERY]);
  } finally {
    enabled.restore();
  }
  const disabled = stubReducedMotion(false);
  try {
    assert.equal(prefersReducedMotion(), false);
  } finally {
    disabled.restore();
  }
});

test("a reduced-motion user never loads the particle engine", async () => {
  const dom = installTestDom();
  const stub = stubReducedMotion(true);
  try {
    const state = recorder();
    let loads = 0;
    const fired = await fireTimelineSuccessConfetti(newCanvas(), () => {
      loads += 1;
      return state.load();
    });
    assert.equal(fired, false);
    assert.equal(loads, 0);
    assert.equal(state.targets.length, 0);
  } finally {
    stub.restore();
    await dom.restore();
  }
});

test("one celebration fires two side cannons and a centre burst", async () => {
  const dom = installTestDom();
  const stub = stubReducedMotion(false);
  try {
    const state = recorder();
    const target = newCanvas();
    const fired = await fireTimelineSuccessConfetti(target, state.load);
    assert.equal(fired, true);
    assert.deepEqual(state.targets, [target]);
    assert.equal(state.shots.length, 3);
    assert.deepEqual(
      state.shots.map((shot) => shot.origin),
      [
        { x: 0, y: 0.72 },
        { x: 1, y: 0.72 },
        { x: 0.5, y: 0.42 },
      ]
    );
    // Velocities are tuned for a panel-sized canvas, not a full viewport.
    for (const shot of state.shots) {
      assert.ok((shot.startVelocity ?? 0) <= 30);
      assert.ok((shot.particleCount ?? 0) <= 45);
      assert.ok((shot.ticks ?? 0) <= 240);
      assert.ok((shot.colors?.length ?? 0) > 0);
    }
    assert.equal(state.resets, 1);
  } finally {
    stub.restore();
    await dom.restore();
  }
});

test("a particle engine that cannot load keeps the static result", async () => {
  const dom = installTestDom();
  const stub = stubReducedMotion(false);
  try {
    const fired = await fireTimelineSuccessConfetti(newCanvas(), () =>
      Promise.reject(new Error("canvas unavailable"))
    );
    assert.equal(fired, false);
  } finally {
    stub.restore();
    await dom.restore();
  }
});

test("the confetti surface stays mounted but only draws while active", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const state = recorder();
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <DeploymentTaskSuccessConfetti
          active={false}
          loadConfetti={state.load}
        />
      );
    });
    const container = rendered?.container;
    assert.ok(container);
    assert.match(container.innerHTML, CONFETTI_SLOT_RE);
    assert.equal(state.targets.length, 0);
    // Mounted is not the same as celebrating, and the surface says which it is:
    // counting canvases is a valid way to count celebrations.
    const surface = container.querySelector("canvas");
    assert.ok(surface);
    assert.equal(surface.dataset.active, "false");

    // The centre burst is deliberately staggered, so the drain has to outlast
    // it before the shot count is meaningful.
    await actAndDrain(() => {
      rendered?.rerender(
        <DeploymentTaskSuccessConfetti active loadConfetti={state.load} />
      );
    }, 300);
    assert.equal(state.targets.length, 1);
    assert.equal(state.shots.length, 3);
    assert.equal(surface.dataset.active, "true");
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
