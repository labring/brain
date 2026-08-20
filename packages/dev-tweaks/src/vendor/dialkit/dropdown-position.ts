// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
export type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  above: boolean;
};

export type DropdownPositionOptions = {
  dropdownHeight?: number;
  gap?: number;
  allowAbove?: boolean;
};

export function getDropdownPosition(
  trigger: HTMLElement,
  portalRoot: HTMLElement,
  options: DropdownPositionOptions = {}
): DropdownPosition {
  const { dropdownHeight = 0, gap = 4, allowAbove = true } = options;
  const triggerRect = trigger.getBoundingClientRect();
  const rootRect = portalRoot.getBoundingClientRect();
  const spaceBelow = window.innerHeight - triggerRect.bottom - gap;
  const above = allowAbove && spaceBelow < dropdownHeight && triggerRect.top > spaceBelow;

  return {
    top: above
      ? triggerRect.top - rootRect.top - dropdownHeight - gap
      : triggerRect.bottom - rootRect.top + gap,
    left: triggerRect.left - rootRect.left,
    width: triggerRect.width,
    above,
  };
}

export function getDialKitPortalRoot(trigger: HTMLElement | null | undefined): HTMLElement | null {
  return (trigger?.closest('.dialkit-root') as HTMLElement | null) ?? null;
}
