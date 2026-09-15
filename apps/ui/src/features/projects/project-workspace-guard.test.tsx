import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { getDefaultStore } from "jotai";

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
  projects: [] as ProjectExplorerProject[],
  projectsLoaded: false,
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
  useProjectsExplorerReadModel: () => ({
    data: { aps: undefined, dbs: undefined },
    devMockActive: explorer.devMockActive,
    projectsLoaded: explorer.projectsLoaded,
    refreshProjects: async () => undefined,
    states: { pinnedProjectIds: [], projects: explorer.projects },
  }),
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
  explorer.projects = [];
  explorer.projectsLoaded = false;
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
  assert.deepEqual(route.replaced, ["/project"]);
  assert.deepEqual(toasts, [PROJECT_NOT_IN_WORKSPACE_NOTICE]);
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
