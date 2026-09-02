const EDITABLE_HOTKEY_IGNORE_SELECTOR =
  '[contenteditable="true"], [data-canvas-hotkeys="ignore"]';

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    target.closest(EDITABLE_HOTKEY_IGNORE_SELECTOR) !== null
  );
}
