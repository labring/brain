import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";

// `server-only` throws outside a React server runtime (repo pattern); the
// layout reaches it through the Devbox warmup server action.
mock.module("server-only", () => ({}));

const { DevboxBootstrap, SealosSdkBootstrap } = await import(
  "@/features/shell/auth-bootstrap"
);
const { default: ProjectLayout } = await import("./layout");

/**
 * Collects the component types in a returned element tree without rendering,
 * so this stays a structural assertion instead of booting the whole app shell.
 */
function mountedComponents(
  node: ReactNode,
  found: Set<unknown> = new Set()
): Set<unknown> {
  if (Array.isArray(node)) {
    for (const child of node) {
      mountedComponents(child, found);
    }
    return found;
  }
  if (!isValidElement(node)) {
    return found;
  }
  found.add(node.type);
  return mountedComponents(
    (node.props as { children?: ReactNode }).children,
    found
  );
}

// `DevboxBootstrap` stayed exported and unit-tested for weeks after it was
// unmounted, which silently pushed Devbox cold start onto the streaming path.
// Assert the mount itself, not just the component's behaviour.
test("project layout mounts the Devbox warmup", () => {
  const mounted = mountedComponents(ProjectLayout({ children: null }));

  assert.ok(mounted.has(DevboxBootstrap), "DevboxBootstrap is mounted");
  assert.ok(mounted.has(SealosSdkBootstrap), "SealosSdkBootstrap is mounted");
});
