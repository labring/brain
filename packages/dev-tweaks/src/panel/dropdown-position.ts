export interface DropdownPosition {
  above: boolean;
  left: number;
  top: number;
  width: number;
}

export interface DropdownPositionOptions {
  allowAbove?: boolean;
  dropdownHeight?: number;
  gap?: number;
}

export function getDropdownPosition(
  trigger: HTMLElement,
  portalRoot: HTMLElement,
  options: DropdownPositionOptions = {}
): DropdownPosition {
  const { dropdownHeight = 0, gap = 4, allowAbove = true } = options;
  const triggerRect = trigger.getBoundingClientRect();
  const rootRect = portalRoot.getBoundingClientRect();
  const spaceBelow = window.innerHeight - triggerRect.bottom - gap;
  const above =
    allowAbove && spaceBelow < dropdownHeight && triggerRect.top > spaceBelow;

  return {
    top: above
      ? triggerRect.top - rootRect.top - dropdownHeight - gap
      : triggerRect.bottom - rootRect.top + gap,
    left: triggerRect.left - rootRect.left,
    width: triggerRect.width,
    above,
  };
}

export function getDevTweaksPortalRoot(
  trigger: HTMLElement | null | undefined
): HTMLElement | null {
  return (trigger?.closest(".dev-tweaks-root") as HTMLElement | null) ?? null;
}
