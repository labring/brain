import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { isEditableKeyboardTarget } from "./is-editable-keyboard-target";

async function withDom(run: () => void): Promise<void> {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register();
  try {
    run();
  } finally {
    await GlobalRegistrator.unregister();
  }
}

test("input, textarea, and select are editable keyboard targets", async () => {
  await withDom(() => {
    for (const tagName of ["input", "textarea", "select"] as const) {
      assert.equal(
        isEditableKeyboardTarget(document.createElement(tagName)),
        true,
        tagName
      );
    }
  });
});

test("a contenteditable element is an editable keyboard target", async () => {
  await withDom(() => {
    const element = document.createElement("div");
    element.contentEditable = "true";
    assert.equal(isEditableKeyboardTarget(element), true);
  });
});

test("a descendant of a contenteditable or ignore-hotkeys host is editable", async () => {
  await withDom(() => {
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    host.append(child);
    document.body.append(host);
    assert.equal(isEditableKeyboardTarget(child), true);

    const ignoreHost = document.createElement("div");
    ignoreHost.setAttribute("data-canvas-hotkeys", "ignore");
    const ignored = document.createElement("span");
    ignoreHost.append(ignored);
    document.body.append(ignoreHost);
    assert.equal(isEditableKeyboardTarget(ignored), true);
  });
});

test("a plain element is not an editable keyboard target", async () => {
  await withDom(() => {
    assert.equal(
      isEditableKeyboardTarget(document.createElement("div")),
      false
    );
    assert.equal(isEditableKeyboardTarget(null), false);
  });
});
