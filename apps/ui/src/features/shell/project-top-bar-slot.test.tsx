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
  ProjectTopBarSlot,
  ProjectTopBarSlotHost,
  ProjectTopBarSlotProvider,
} from "./project-top-bar-slot";

async function withDom(run: () => Promise<void>): Promise<void> {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  try {
    await run();
  } finally {
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
}

test("slot content mounts into the top bar host, not in place", async () => {
  await withDom(async () => {
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(
        <ProjectTopBarSlotProvider>
          <header>
            <ProjectTopBarSlotHost />
          </header>
          <main>
            <ProjectTopBarSlot>
              <span data-testid="slot-content">dock</span>
            </ProjectTopBarSlot>
          </main>
        </ProjectTopBarSlotProvider>
      );
    });

    const host = document.querySelector('[data-slot="project-top-bar-slot"]');
    const content = document.querySelector('[data-testid="slot-content"]');
    assert.notEqual(host, null);
    assert.notEqual(content, null);
    assert.equal(host?.contains(content), true);
    assert.equal(document.querySelector("main")?.contains(content), false);
    await actAndDrain(() => {
      rendered?.unmount();
    });
  });
});

test("slot content unmounts from the host with its owner", async () => {
  await withDom(async () => {
    function Tree({ withContent }: { withContent: boolean }) {
      return (
        <ProjectTopBarSlotProvider>
          <header>
            <ProjectTopBarSlotHost />
          </header>
          {withContent ? (
            <ProjectTopBarSlot>
              <span data-testid="slot-content">dock</span>
            </ProjectTopBarSlot>
          ) : null}
        </ProjectTopBarSlotProvider>
      );
    }
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(<Tree withContent />);
    });
    assert.notEqual(
      document.querySelector('[data-testid="slot-content"]'),
      null
    );

    await actAndDrain(() => {
      rendered?.rerender(<Tree withContent={false} />);
    });
    assert.equal(document.querySelector('[data-testid="slot-content"]'), null);
    await actAndDrain(() => {
      rendered?.unmount();
    });
  });
});

test("slot renders children in place outside a provider", async () => {
  await withDom(async () => {
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(
        <main>
          <ProjectTopBarSlot>
            <span data-testid="slot-content">dock</span>
          </ProjectTopBarSlot>
        </main>
      );
    });

    const content = document.querySelector('[data-testid="slot-content"]');
    assert.notEqual(content, null);
    assert.equal(document.querySelector("main")?.contains(content), true);
    await actAndDrain(() => {
      rendered?.unmount();
    });
  });
});

test("slot renders nothing while the provider has no host", async () => {
  await withDom(async () => {
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(
        <ProjectTopBarSlotProvider>
          <ProjectTopBarSlot>
            <span data-testid="slot-content">dock</span>
          </ProjectTopBarSlot>
        </ProjectTopBarSlotProvider>
      );
    });

    assert.equal(document.querySelector('[data-testid="slot-content"]'), null);
    await actAndDrain(() => {
      rendered?.unmount();
    });
  });
});
