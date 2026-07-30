import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react/pure";
import { act } from "react";

import { Pagination } from "./pagination";

const PAGE_POSITION_RE = /2\s*\/\s*3/;

function installPaginationTestDom() {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register({ url: "https://pagination.test" });
  return () => GlobalRegistrator.unregister();
}

test("Pagination emits controlled first, previous, next, and last page changes", async () => {
  const restoreDom = installPaginationTestDom();
  const pageChanges: number[] = [];
  const rendered = render(
    <Pagination
      currentPage={2}
      onPageChange={(page) => pageChanges.push(page)}
      totalPages={3}
    />
  );

  try {
    assert.match(rendered.container.textContent ?? "", PAGE_POSITION_RE);

    await act(() =>
      rendered.getByRole("button", { name: "First page" }).click()
    );
    await act(() =>
      rendered.getByRole("button", { name: "Previous page" }).click()
    );
    await act(() =>
      rendered.getByRole("button", { name: "Next page" }).click()
    );
    await act(() =>
      rendered.getByRole("button", { name: "Last page" }).click()
    );

    assert.deepEqual(pageChanges, [1, 1, 3, 3]);
  } finally {
    await act(() => rendered.unmount());
    await restoreDom();
  }
});
