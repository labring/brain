import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react/pure";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SidePane, SidePaneFooter, SidePanePresence } from "./side-pane";

const noop = () => {
  /* test noop */
};

const ASIDE_RE = /<aside/;
const BODY_RE = /Pane body/;
const BUSY_RE = /aria-busy="true"/;
const CLOSE_LABEL_RE = /Close details/;
const CLOSED_RE = /aria-hidden="true"/;
const DESCRIPTION_RE = /Secondary copy/;
const GLOW_RE = /data-slot="side-pane-glow"/;
const GLOW_SETTLE_RE = /side-pane-glow-settle/;
const MOTION_REDUCE_TRANSFORM_RE = /motion-reduce:transform-none/;
const MOTION_REDUCE_TRANSITION_RE = /motion-reduce:transition-none/;
const OPEN_ASIDE_RE = /<aside aria-hidden="false"/;
const OPEN_DURATION_RE =
  /duration-\[var\(--project-surface-motion-enter-duration\)\]/;
const OPEN_MAX_WIDTH_RE = /max-w-screen-sm/;
const OPEN_OPACITY_RE = /opacity-100/;
const OPEN_SLIDE_RE = /project-surface-slide-x-open/;
const OPEN_WIDTH_RE = /w-full/;
const PANE_LABEL_RE = /aria-label="Details pane"/;
const POINTER_EVENTS_NONE_RE = /pointer-events-none/;
const PROJECT_CHROME_SURFACE_RE = /project-chrome-surface/;
const SLIDE_X_RE = /project-surface-slide-x/;
const SCROLL_BEFORE_CONTENT_GAP_RE = /flex min-h-0 flex-1 flex-col gap-2.5/;
const SCROLL_BODY_RE = /scrollbar-chat-thin min-h-0 flex-1 overflow-y-auto/;
const SCROLL_CONTENT_RE =
  /flex min-h-full min-w-0 flex-col gap-5 px-5 pt-2.5 pb-5/;
const TITLE_RE = /Details/;
const TITLE_ROW_GAP_RE = /flex min-w-0 items-center gap-2"/;
const CLOSED_SLIDE_FULL_RE = /project-surface-slide-x-full/;

function indexOfOrThrow(source: string, needle: string) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `${needle} should be present`);
  return index;
}

test("side pane renders shared chrome, accessibility labels, and motion-safe classes", () => {
  const html = renderToStaticMarkup(
    <SidePane
      busy
      closeAriaLabel="Close details"
      icon={<span data-slot="test-icon" />}
      label="Details pane"
      onClose={noop}
      subtitle="Secondary copy"
      title="Details"
    >
      <p>Pane body</p>
    </SidePane>
  );

  assert.match(html, ASIDE_RE);
  assert.match(html, PANE_LABEL_RE);
  assert.match(html, BUSY_RE);
  assert.match(html, CLOSE_LABEL_RE);
  assert.match(html, TITLE_RE);
  assert.match(html, DESCRIPTION_RE);
  assert.match(html, BODY_RE);
  assert.match(html, PROJECT_CHROME_SURFACE_RE);
  assert.match(html, SLIDE_X_RE);
  assert.match(html, GLOW_RE);
  assert.doesNotMatch(html, GLOW_SETTLE_RE);
  assert.match(html, MOTION_REDUCE_TRANSITION_RE);
  assert.match(html, SCROLL_BEFORE_CONTENT_GAP_RE);
  assert.match(html, TITLE_ROW_GAP_RE);
});

test("side pane keeps shared header outside the edge-aligned scroll body", () => {
  const html = renderToStaticMarkup(
    <SidePane label="Details pane" onClose={noop} title="Details">
      <p>Pane body</p>
    </SidePane>
  );

  const headerIndex = indexOfOrThrow(html, "<header");
  const scrollBodyIndex = indexOfOrThrow(html, SCROLL_BODY_RE.source);
  const scrollContentIndex = indexOfOrThrow(html, SCROLL_CONTENT_RE.source);
  const bodyIndex = indexOfOrThrow(html, "Pane body");

  assert.ok(headerIndex < scrollBodyIndex);
  assert.ok(scrollBodyIndex < scrollContentIndex);
  assert.ok(scrollContentIndex < bodyIndex);
});

test("side pane closed state is non-interactive and keeps reduced-motion structure", () => {
  const html = renderToStaticMarkup(
    <SidePane
      closeAriaLabel="Close"
      label="Details pane"
      onClose={noop}
      open={false}
      title="Details"
    >
      <p>Pane body</p>
    </SidePane>
  );

  assert.match(html, CLOSED_RE);
  assert.match(html, POINTER_EVENTS_NONE_RE);
  assert.match(html, CLOSED_SLIDE_FULL_RE);
  assert.match(html, MOTION_REDUCE_TRANSFORM_RE);
});

function installSidePaneTestDom() {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register({ url: "https://side-pane.test" });
  return () => GlobalRegistrator.unregister();
}

async function withMountedPane(
  element: ReactElement,
  run: (rendered: ReturnType<typeof render>) => Promise<void> | void
) {
  const restoreDom = installSidePaneTestDom();
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

function footerRegion(container: HTMLElement) {
  return container.querySelector('[data-slot="side-pane-footer"]');
}

test("side pane footer pins slot content outside the scroll container", async () => {
  await withMountedPane(
    <SidePane label="Details pane" onClose={noop} title="Details">
      <p>Pane body</p>
      <SidePaneFooter>
        <button type="button">Deploy</button>
      </SidePaneFooter>
    </SidePane>,
    ({ container }) => {
      const region = footerRegion(container);
      assert.ok(region, "footer region should render");
      const deploy = region.querySelector("button");
      assert.equal(deploy?.textContent, "Deploy");
      assert.equal(
        region.closest(".overflow-y-auto"),
        null,
        "footer must not live inside the scroll container"
      );
      assert.ok(
        region.closest(".project-chrome-surface"),
        "footer must slide with the inner chrome surface"
      );
      const scrollBody = container.querySelector(".overflow-y-auto");
      assert.ok(scrollBody);
      const documentOrder = [...container.querySelectorAll("*")];
      assert.ok(
        documentOrder.indexOf(scrollBody) < documentOrder.indexOf(region),
        "footer must follow the scroll body in tab order"
      );
      assert.ok(
        region.className.includes("justify-end"),
        "footer container owns the right-aligned action row"
      );
      assert.ok(
        region.className.includes("border-t"),
        "footer is separated by a top border"
      );
    }
  );
});

test("side pane footer accepts contributions from deep in the children tree", async () => {
  function DeepContributor() {
    return (
      <SidePaneFooter>
        <button type="button">Update</button>
      </SidePaneFooter>
    );
  }
  await withMountedPane(
    <SidePane label="Details pane" onClose={noop} title="Details">
      <div>
        <section>
          <DeepContributor />
        </section>
      </div>
    </SidePane>,
    ({ container }) => {
      const region = footerRegion(container);
      assert.ok(region, "deep contribution should open the footer region");
      assert.equal(region.querySelector("button")?.textContent, "Update");
      assert.equal(region.closest(".overflow-y-auto"), null);
    }
  );
});

test("side pane without footer contribution renders no footer region", async () => {
  await withMountedPane(
    <SidePane label="Details pane" onClose={noop} title="Details">
      <p>Pane body</p>
    </SidePane>,
    ({ container }) => {
      assert.equal(footerRegion(container), null);
    }
  );
});

test("side pane footer region unmounts when its contributor leaves", async () => {
  await withMountedPane(
    <SidePane label="Details pane" onClose={noop} title="Details">
      <SidePaneFooter>
        <button type="button">Deploy</button>
      </SidePaneFooter>
    </SidePane>,
    async (rendered) => {
      assert.ok(footerRegion(rendered.container));
      await act(() => {
        rendered.rerender(
          <SidePane label="Details pane" onClose={noop} title="Details">
            <p>No actions here</p>
          </SidePane>
        );
      });
      assert.equal(footerRegion(rendered.container), null);
    }
  );
});

test("side pane footer slot without a side pane renders its content in place", async () => {
  await withMountedPane(
    <SidePaneFooter>
      <button type="button">Deploy</button>
    </SidePaneFooter>,
    ({ container }) => {
      assert.equal(footerRegion(container), null);
      assert.equal(container.querySelector("button")?.textContent, "Deploy");
    }
  );
});

test("side pane presence choreography is unchanged by footer presence", async () => {
  await withMountedPane(
    <SidePanePresence>
      <SidePane label="Details pane" onClose={noop} title="Details">
        <p>Pane body</p>
        <SidePaneFooter>
          <button type="button">Deploy</button>
        </SidePaneFooter>
      </SidePane>
    </SidePanePresence>,
    async ({ container }) => {
      // Enter choreography defers the open transform by two frames.
      await act(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve());
            });
          })
      );
      const aside = container.querySelector("aside");
      assert.ok(aside);
      assert.equal(aside.getAttribute("data-state"), "open");
      assert.match(aside.className, OPEN_SLIDE_RE);
      assert.ok(footerRegion(container));
    }
  );
});

test("side pane presence renders initial pane content open", () => {
  const html = renderToStaticMarkup(
    <SidePanePresence>
      <SidePane label="Details pane" onClose={noop} title="Details">
        <p>Pane body</p>
      </SidePane>
    </SidePanePresence>
  );

  assert.match(html, PANE_LABEL_RE);
  assert.match(html, OPEN_ASIDE_RE);
  assert.match(html, OPEN_WIDTH_RE);
  assert.match(html, OPEN_MAX_WIDTH_RE);
  assert.match(html, OPEN_SLIDE_RE);
  assert.match(html, OPEN_OPACITY_RE);
  assert.match(html, OPEN_DURATION_RE);
  assert.doesNotMatch(html, GLOW_SETTLE_RE);
  assert.doesNotMatch(html, CLOSED_SLIDE_FULL_RE);
});
