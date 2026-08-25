import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { SIDEBAR_COOKIE_NAME } from "@workspace/ui/lib/sidebar-cookie";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";
import {
  actAndDrain,
  defineGlobal,
  installTestDom,
  jsonResponse,
  requestUrl,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import type {
  ProjectExplorerProject,
  ProjectExplorerStates,
} from "@/features/projects/explorer/project-explorer.types";
import {
  appTokenAtom,
  desktopUserAvatarAtom,
  desktopUserIdAtom,
  desktopUserNameAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/lib/auth-store";

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

// The account section reads the subscription through the real billing proxy
// loader; the fetch stub serves these fixtures. null = the route fails and
// the section must degrade.
const billing = {
  subscription: null as Record<string, unknown> | null,
};
const workspaceQuota = { items: [] as unknown[] };

const ACCOUNT_USER = { id: "usr-Kx92mQ", name: "Ada Lovelace" };
const ACCOUNT_NAME_RE = /Ada Lovelace/;
const ACCOUNT_ID_RE = new RegExp(`ID: ${ACCOUNT_USER.id}`);

function proSubscription(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    CancelAtPeriodEnd: false,
    CurrentPeriodEndAt: "2026-09-12T12:00:00Z",
    PayMethod: "stripe",
    PlanName: "PRO",
    Status: "normal",
    type: "SUBSCRIPTION",
    ...overrides,
  };
}

function billingFetchStub(input: unknown): Promise<Response> {
  const url = requestUrl(input);
  if (url === "/api/billing/regions") {
    return Promise.resolve(
      jsonResponse({ current: { domain: "billing.test", uid: "region-1" } })
    );
  }
  if (url === "/api/billing/subscription") {
    if (billing.subscription == null) {
      return Promise.resolve(new Response("{}", { status: 500 }));
    }
    return Promise.resolve(
      jsonResponse({ subscription: billing.subscription })
    );
  }
  return Promise.resolve(new Response("{}", { status: 404 }));
}

// Each scenario gets its own workspace so SWR's cache never replays another
// test's subscription summary.
function hydrateAccountAtoms(workspace: string) {
  const store = getDefaultStore();
  store.set(appTokenAtom, "desktop-app-token");
  store.set(kubeconfigAtom, "apiVersion: v1");
  store.set(namespaceAtom, workspace);
  store.set(desktopUserIdAtom, ACCOUNT_USER.id);
  store.set(desktopUserNameAtom, ACCOUNT_USER.name);
  store.set(desktopUserAvatarAtom, "");
}

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
    getWorkspaceQuota: async () => ({ quota: workspaceQuota.items }),
    runEvents: async () => undefined,
  },
}));

// Base UI resolves its isomorphic layout effect at module load — with no DOM
// registered it becomes a permanent noop and popovers can never open. Load
// the component modules under a throwaway DOM so those bindings are real.
const moduleDom = installTestDom();
const { render } = await import("@testing-library/react/pure");
const { JotaiProvider } = await import("@/features/shell/jotai-provider");
const { default: AppSidebar, AppSidebarShell } = await import("./app-sidebar");
await moduleDom.restore();

async function withSidebar(
  run: () => void | Promise<void>,
  defaultOpen = true,
  beforeRender?: () => void
): Promise<void> {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const fetchOverride = defineGlobal("fetch", billingFetchStub);
  let rendered: ReturnType<typeof render> | undefined;
  try {
    beforeRender?.();
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
  } finally {
    // Unmount in the cleanup path — a failing scenario must not leave the
    // tree mounted against a torn-down DOM, poisoning every later test.
    await actAndDrain(() => {
      rendered?.unmount();
    }).catch(() => undefined);
    explorer.states = { pinnedProjectIds: ["alpha"], projects };
    billing.subscription = null;
    workspaceQuota.items = [];
    restoreGlobal(fetchOverride);
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
}

function sidebarHeadings(nav: Element | null): string[] {
  return [...(nav?.querySelectorAll(".app-sidebar-heading") ?? [])].map(
    (heading) => heading.textContent?.trim() ?? ""
  );
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
    assert.deepEqual(sidebarHeadings(nav), ["Pinned", "Projects"]);
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

test("an empty Pinned group is omitted", async () => {
  explorer.states = { pinnedProjectIds: [], projects };
  await withSidebar(() => {
    assert.equal(
      document.querySelector('[data-slot="app-sidebar-pinned"]'),
      null
    );
    assert.deepEqual(
      sidebarHeadings(document.querySelector("#app-sidebar-nav")),
      ["Projects"]
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

    assert.ok(document.querySelector('[aria-label="Sealos Desktop"]'));
    const billing = document.querySelector('a[href="/billing"]');
    assert.ok(billing);
    assert.equal(billing.getAttribute("aria-label"), "Billing");
    assert.equal(billing.getAttribute("aria-current"), null);
    // AIM-308: the account section replaced the Upgrade button as the
    // sidebar's single quota surface.
    assert.equal(document.querySelector('[aria-label="Upgrade"]'), null);
    assert.ok(document.querySelector('[data-slot="app-sidebar-account"]'));
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

test("the account row shows the session identity with the plan badge", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      assert.equal(row.getAttribute("aria-label"), "Account: Ada Lovelace");
      assert.match(row.textContent ?? "", ACCOUNT_NAME_RE);
      assert.equal(
        row
          .querySelector('[data-slot="app-sidebar-account-status"]')
          ?.textContent?.trim(),
        `ID: ${ACCOUNT_USER.id}`
      );
      assert.equal(
        row.querySelector('[data-slot="plan-badge"]')?.textContent?.trim(),
        "PRO"
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-row")
  );
});

test("an attention lifecycle replaces the ID line with a status hint", async () => {
  billing.subscription = proSubscription({ Status: "debt" });
  await withSidebar(
    () => {
      const status = document.querySelector(
        '[data-slot="app-sidebar-account-status"]'
      );
      assert.equal(
        status?.textContent?.trim(),
        "Payment due · service limited"
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-debt")
  );
});

test("a failed subscription read degrades to the quiet ID line without a badge", async () => {
  billing.subscription = null;
  await withSidebar(
    () => {
      const row = document.querySelector('[data-slot="app-sidebar-account"]');
      assert.ok(row);
      assert.equal(row.querySelector('[data-slot="plan-badge"]'), null);
      assert.equal(
        row
          .querySelector('[data-slot="app-sidebar-account-status"]')
          ?.textContent?.trim(),
        `ID: ${ACCOUNT_USER.id}`
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-degraded")
  );
});

test("clicking the account row opens the popover with quota, copy, and upgrade", async () => {
  billing.subscription = proSubscription();
  workspaceQuota.items = [
    { limit: 4000, type: "cpu", used: 1900 },
    { limit: 8192, type: "memory", used: 6963 },
    { limit: 51_200, type: "storage", used: 12_288 },
    { limit: 32, type: "pod", used: 14 },
    { limit: 8, type: "nodeport", used: 3 },
  ];
  const copies: string[] = [];
  await withSidebar(
    async () => {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            copies.push(text);
            return Promise.resolve();
          },
        },
      });

      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      const quotaRows = [
        ...popover.querySelectorAll('[data-slot="app-sidebar-quota-row"]'),
      ];
      assert.equal(quotaRows.length, 5);
      assert.deepEqual(
        quotaRows.map((quotaRow) => quotaRow.getAttribute("data-warning")),
        // Memory sits at 85% — the one row at or above the warning threshold.
        [null, "true", null, null, null]
      );
      assert.ok(popover.querySelector('a[href="/billing?mode=upgrade"]'));

      const copy = popover.querySelector<HTMLButtonElement>(
        '[aria-label="Copy user ID"]'
      );
      assert.ok(copy);
      assert.match(copy.textContent ?? "", ACCOUNT_ID_RE);
      await actAndDrain(() => {
        copy.click();
      });
      assert.deepEqual(copies, [ACCOUNT_USER.id]);
    },
    true,
    () => hydrateAccountAtoms("ws-account-popover")
  );
});

test("the collapsed rail keeps the account section as an avatar button", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      assert.equal(sidebarState(), "collapsed");
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      assert.equal(row.getAttribute("aria-label"), "Account: Ada Lovelace");

      await actAndDrain(() => {
        row.click();
      });
      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      assert.match(popover.textContent ?? "", ACCOUNT_NAME_RE);
    },
    false,
    () => hydrateAccountAtoms("ws-account-rail")
  );
});
