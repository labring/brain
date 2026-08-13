import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { SIDEBAR_COOKIE_NAME } from "@workspace/ui/lib/sidebar-cookie";
import type { ReactNode } from "react";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import type {
  ProjectExplorerProject,
  ProjectExplorerStates,
} from "@/features/projects/explorer/project-explorer.types";

const projects: ProjectExplorerProject[] = [
  { createdAt: "2026-05-26T00:00:00.000Z", id: "alpha", name: "Alpha" },
  { createdAt: "2026-05-26T00:00:00.000Z", id: "beta", name: "Beta" },
  { createdAt: "2026-05-26T00:00:00.000Z", id: "gamma", name: "Gamma" },
];

const route = { pathname: "/project/alpha" };
const explorer = {
  states: {
    pinnedProjectIds: ["alpha"],
    projects,
  } satisfies ProjectExplorerStates,
};
const PINNED_RE = /PINNED/;
const PROJECTS_RE = /PROJECTS/;
const UPGRADE_RE = /Upgrade/;

mock.module("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

mock.module("next/link", () => ({
  default({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href: string;
  } & Record<string, unknown>) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("@/features/projects/explorer/use-projects-explorer", () => ({
  useProjectsExplorerReadModel: () => ({
    data: { aps: undefined, dbs: undefined },
    refreshProjects: async () => undefined,
    states: explorer.states,
  }),
}));

mock.module("@labring/sealos-desktop-sdk/app", () => ({
  sealosApp: {
    getHostConfig: async () => ({ cloud: { domain: "https://desktop.test" } }),
    getWorkspaceQuota: async () => ({ quota: [] }),
    runEvents: async () => undefined,
  },
}));

const { render } = await import("@testing-library/react/pure");
const { JotaiProvider } = await import("@/features/shell/jotai-provider");
const { default: AppSidebar, AppSidebarShell } = await import("./app-sidebar");

async function withSidebar(
  run: () => void | Promise<void>,
  defaultOpen = true
): Promise<void> {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  try {
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(
        <JotaiProvider>
          <AppSidebarShell defaultOpen={defaultOpen}>
            <AppSidebar />
          </AppSidebarShell>
        </JotaiProvider>
      );
    });
    await run();
    await actAndDrain(() => {
      rendered?.unmount();
    });
  } finally {
    explorer.states = { pinnedProjectIds: ["alpha"], projects };
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
}

function sidebarState(): string | null {
  return (
    document
      .querySelector("[data-slot='sidebar']")
      ?.getAttribute("data-state") ?? null
  );
}

function cookieValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

test("app sidebar defaults to Expanded and collapses from the header button", async () => {
  await withSidebar(async () => {
    assert.equal(sidebarState(), "expanded");
    const collapse = document.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse sidebar"]'
    );
    assert.ok(collapse);
    assert.equal(collapse.getAttribute("aria-expanded"), "true");
    assert.equal(collapse.getAttribute("aria-controls"), "app-sidebar-nav");

    await actAndDrain(() => {
      collapse.click();
    });

    assert.equal(sidebarState(), "collapsed");
    assert.equal(cookieValue(SIDEBAR_COOKIE_NAME), "false");
    const expand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(expand);
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, expand);
  });
});

test("collapsed logo slot expands the sidebar and moves focus to collapse", async () => {
  await withSidebar(async () => {
    assert.equal(sidebarState(), "collapsed");
    const expand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(expand);
    await actAndDrain(() => {
      expand.click();
    });
    assert.equal(sidebarState(), "expanded");
    assert.equal(cookieValue(SIDEBAR_COOKIE_NAME), "true");
    assert.equal(
      document.activeElement,
      document.querySelector('[aria-label="Collapse sidebar"]')
    );
  }, false);
});

test("Cmd+B toggles the sidebar except inside an editable target", async () => {
  await withSidebar(async () => {
    await actAndDrain(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true })
      );
    });
    assert.equal(sidebarState(), "collapsed");

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await actAndDrain(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true })
      );
    });
    assert.equal(sidebarState(), "collapsed");
    input.remove();
  });
});

test("pinned projects stay above the remaining projects", async () => {
  await withSidebar(() => {
    const nav = document.querySelector("#app-sidebar-nav");
    assert.ok(nav);
    assert.equal(nav.getAttribute("aria-label"), "Projects");
    assert.ok(document.querySelector('[data-slot="app-sidebar-pinned"]'));
    assert.match(nav.textContent ?? "", PINNED_RE);
    assert.match(nav.textContent ?? "", PROJECTS_RE);
    const pinnedLink = document.querySelector(
      '[aria-label="Pinned project: Alpha"]'
    );
    assert.ok(pinnedLink);
    const projectLinks = [...nav.querySelectorAll("a")].filter((link) =>
      link.getAttribute("href")?.startsWith("/project/")
    );
    assert.deepEqual(
      projectLinks.map((link) => link.getAttribute("href")),
      ["/project/alpha", "/project/beta", "/project/gamma"]
    );
  });
});

test("an empty PINNED group is omitted", async () => {
  explorer.states = { pinnedProjectIds: [], projects };
  await withSidebar(() => {
    assert.equal(
      document.querySelector('[data-slot="app-sidebar-pinned"]'),
      null
    );
    assert.doesNotMatch(
      document.querySelector("#app-sidebar-nav")?.textContent ?? "",
      PINNED_RE
    );
  });
});

test("the active project uses aria-current and locked copy is present", async () => {
  await withSidebar(() => {
    const projectsLink = document.querySelector('a[href="/project"]');
    assert.ok(projectsLink);
    assert.equal(projectsLink.textContent?.includes("Projects"), true);
    assert.equal(projectsLink.getAttribute("aria-current"), null);

    const active = document.querySelector('a[href="/project/alpha"]');
    assert.ok(active);
    assert.equal(active.getAttribute("aria-current"), "page");

    assert.ok(document.querySelector('[aria-label="Back to Desktop"]'));
    const billing = document.querySelector('a[href="/billing"]');
    assert.ok(billing);
    assert.equal(billing.getAttribute("aria-label"), "Billing");
    assert.equal(billing.getAttribute("aria-current"), null);
    assert.match(document.body.textContent ?? "", UPGRADE_RE);
    assert.equal(document.querySelector('[aria-label="Brain v2"]'), null);
  });
});

test("tooltips belong to Collapsed; Expanded uses a title fallback", async () => {
  await withSidebar(async () => {
    const expandedRow = document.querySelector('a[href="/project/beta"]');
    assert.ok(expandedRow);
    assert.equal(expandedRow.getAttribute("title"), "Beta");
    assert.notEqual(expandedRow.getAttribute("data-slot"), "tooltip-trigger");

    const collapse = document.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse sidebar"]'
    );
    assert.ok(collapse);
    await actAndDrain(() => {
      collapse.click();
    });

    const collapsedRow = document.querySelector('a[href="/project/beta"]');
    assert.ok(collapsedRow);
    assert.equal(collapsedRow.getAttribute("title"), null);
    assert.equal(collapsedRow.getAttribute("data-slot"), "tooltip-trigger");
  });
});
