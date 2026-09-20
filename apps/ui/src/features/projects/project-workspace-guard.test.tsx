import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { getDefaultStore } from "jotai";
import { useState } from "react";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
  type TestDom,
} from "@/features/project-canvas/react-test-harness";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer.types";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

// The guard's two external facts — the route and the Project list — are
// stood in for here; the assertions are the router call and the toast.
const route = { pathname: "/project/elsewhere", replaced: [] as string[] };
const explorer = {
  devMockActive: false,
  /** What the next revalidation answers with; null keeps the list as is. */
  freshProjects: null as ProjectExplorerProject[] | null,
  /**
   * When set, the revalidation resolves this payload verbatim without
   * touching the rendered list — the snapshot has not painted yet.
   */
  freshPayloadOnly: null as { projects: ProjectExplorerProject[] } | null,
  projects: [] as ProjectExplorerProject[],
  projectsLoaded: false,
  /** When set, the revalidation rejects — the SWR verdict never lands. */
  refreshFails: false,
  refreshes: 0,
};
const toasts: string[] = [];

mock.module("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({
    replace: (href: string) => {
      route.replaced.push(href);
    },
  }),
}));
mock.module("@/features/projects/explorer/use-projects-explorer", () => ({
  useProjectsExplorerReadModel: () => {
    const [, rerender] = useState(0);
    return {
      data: { aps: undefined, dbs: undefined },
      devMockActive: explorer.devMockActive,
      projectsLoaded: explorer.projectsLoaded,
      refreshProjects: () => {
        explorer.refreshes += 1;
        if (explorer.refreshFails) {
          return Promise.reject(new Error("offline"));
        }
        if (explorer.freshPayloadOnly != null) {
          return Promise.resolve(explorer.freshPayloadOnly);
        }
        if (explorer.freshProjects != null) {
          explorer.projects = explorer.freshProjects;
          rerender((n) => n + 1);
        }
        // SWR's mutate resolves with the raw `/api/projects` payload.
        return Promise.resolve({ projects: explorer.projects });
      },
      states: { pinnedProjectIds: [], projects: explorer.projects },
    };
  },
}));
mock.module("sonner", () => ({
  toast: (message: string) => {
    toasts.push(message);
  },
}));

const moduleDom = installTestDom();
const { render } = await import("@testing-library/react/pure");
const { ProjectIdProvider } = await import("@/features/panes/use-project-id");
const { PROJECT_NOT_IN_WORKSPACE_NOTICE, ProjectWorkspaceGuard } = await import(
  "./project-workspace-guard"
);
await moduleDom.restore();

const project = (id: string): ProjectExplorerProject => ({
  createdAt: "2026-05-26T00:00:00.000Z",
  id,
  name: id,
});

let dom: TestDom;
let actEnvironment: boolean | undefined;
let rendered: ReturnType<typeof render> | undefined;

beforeEach(() => {
  dom = installTestDom();
  actEnvironment = setActEnvironment(true);
  const store = getDefaultStore();
  store.set(kubeconfigAtom, "apiVersion: v1");
  store.set(namespaceAtom, "ns-a");
  route.pathname = "/project/elsewhere";
  route.replaced = [];
  explorer.devMockActive = false;
  explorer.freshProjects = null;
  explorer.freshPayloadOnly = null;
  explorer.projects = [];
  explorer.projectsLoaded = false;
  explorer.refreshFails = false;
  explorer.refreshes = 0;
  toasts.length = 0;
});

afterEach(async () => {
  await actAndDrain(() => {
    rendered?.unmount();
    rendered = undefined;
  }).catch(() => undefined);
  restoreActEnvironment(actEnvironment);
  await dom.restore();
});

async function mountGuard() {
  await actAndDrain(() => {
    rendered = render(
      <ProjectIdProvider>
        <ProjectWorkspaceGuard />
      </ProjectIdProvider>
    );
  });
}

test("a loaded list without the Project replaces the route with the Project list and says so", async () => {
  explorer.projects = [project("alpha"), project("beta")];
  explorer.projectsLoaded = true;
  await mountGuard();
  // One revalidation first, so a stale cache never bounces a real Project.
  assert.equal(explorer.refreshes, 1);
  assert.deepEqual(route.replaced, ["/project"]);
  assert.deepEqual(toasts, [PROJECT_NOT_IN_WORKSPACE_NOTICE]);
});

test("a stale cached list that misses a Project created elsewhere stays once the refresh finds it", async () => {
  route.pathname = "/project/created-elsewhere";
  explorer.projects = [project("alpha")];
  explorer.projectsLoaded = true;
  explorer.freshProjects = [project("alpha"), project("created-elsewhere")];
  await mountGuard();
  assert.equal(explorer.refreshes, 1);
  assert.deepEqual(route.replaced, []);
  assert.deepEqual(toasts, []);
});

test("a refresh that fails confirms nothing: the page stays and no toast is served", async () => {
  explorer.projects = [project("alpha")];
  explorer.projectsLoaded = true;
  explorer.refreshFails = true;
  await mountGuard();
  assert.equal(explorer.refreshes, 1);
  assert.deepEqual(route.replaced, []);
  assert.deepEqual(toasts, []);
});

test("a payload that carries the Project holds the guard even before the rendered list paints", async () => {
  route.pathname = "/project/created-elsewhere";
  explorer.projects = [project("alpha")];
  explorer.projectsLoaded = true;
  // The revalidation found it, but the hook's snapshot still lacks it.
  explorer.freshPayloadOnly = {
    projects: [project("alpha"), project("created-elsewhere")],
  };
  await mountGuard();
  assert.equal(explorer.refreshes, 1);
  assert.deepEqual(route.replaced, []);
  assert.deepEqual(toasts, []);
});

test("a loaded list with the Project leaves the page alone", async () => {
  route.pathname = "/project/beta";
  explorer.projects = [project("alpha"), project("beta")];
  explorer.projectsLoaded = true;
  await mountGuard();
  assert.deepEqual(route.replaced, []);
  assert.deepEqual(toasts, []);
});

test("nothing is judged while the list is loading, or under the Projects Dev Mock", async () => {
  await mountGuard();
  assert.deepEqual(route.replaced, []);

  explorer.devMockActive = true;
  explorer.projects = [project("fixture")];
  explorer.projectsLoaded = true;
  await actAndDrain(() => {
    rendered?.unmount();
    rendered = undefined;
  });
  await mountGuard();
  assert.deepEqual(route.replaced, []);
  assert.deepEqual(toasts, []);
});
