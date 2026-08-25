import { createContext, useCallback, useEffect, useRef, useState } from "react";
import {
  applySliderDelta,
  DRAG_SENSITIVITY,
  findControl,
  getActiveModifier,
  getEffectiveStep,
  isInputFocused,
} from "../shortcut-utils";
import { DevTweaksStore } from "../store/dev-tweaks-store";

export const ShortcutContext = createContext<{
  activePanelId: string | null;
  activePath: string | null;
}>({ activePanelId: null, activePath: null });

export function ShortcutListener({ children }: { children: React.ReactNode }) {
  const [activeShortcut, setActiveShortcut] = useState<{
    activePanelId: string | null;
    activePath: string | null;
  }>({ activePanelId: null, activePath: null });

  const activeKeysRef = useRef<Set<string>>(new Set());
  const isDraggingRef = useRef(false);
  const lastMouseXRef = useRef<number | null>(null);
  const dragAccumulatorRef = useRef(0);

  // Find the active target for key-based interactions (scroll, drag, move)
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
  const resolveActiveTarget = useCallback((interaction: string) => {
    for (const key of activeKeysRef.current) {
      // We can't get the modifier from a stored key, so we check all panels
      const panels = DevTweaksStore.getPanels();
      for (const panel of panels) {
        for (const [path, shortcut] of Object.entries(panel.shortcuts)) {
          if (!shortcut.key) {
            continue;
          }
          if (shortcut.key.toLowerCase() !== key) {
            continue;
          }
          if ((shortcut.interaction ?? "scroll") !== interaction) {
            continue;
          }
          const control = findControl(panel.controls, path);
          if (control && control.type === "slider") {
            return { panelId: panel.id, path, control, shortcut };
          }
        }
      }
    }
    return null;
  }, []);

  useEffect(() => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) {
        return;
      }

      const key = e.key.toLowerCase();

      // Arrow keys adjust the active shortcut's slider
      if (
        (key === "arrowleft" ||
          key === "arrowright" ||
          key === "arrowup" ||
          key === "arrowdown") &&
        activeKeysRef.current.size > 0
      ) {
        const target =
          resolveActiveTarget("scroll") ||
          resolveActiveTarget("drag") ||
          resolveActiveTarget("move");
        if (target && target.control.type === "slider") {
          e.preventDefault();
          const direction = key === "arrowright" || key === "arrowup" ? 1 : -1;
          const effectiveStep = getEffectiveStep(
            target.control,
            target.shortcut
          );
          applySliderDelta(
            target.panelId,
            target.path,
            target.control,
            effectiveStep,
            direction
          );
          return;
        }
      }

      const wasAlreadyHeld = activeKeysRef.current.has(key);
      activeKeysRef.current.add(key);

      const modifier = getActiveModifier(e);
      const target = DevTweaksStore.resolveShortcutTarget(key, modifier);
      if (target) {
        setActiveShortcut({
          activePanelId: target.panelId,
          activePath: target.path,
        });

        // Toggle: flip on first keydown only (not on key repeat)
        if (!wasAlreadyHeld && target.control.type === "toggle") {
          const currentValue = DevTweaksStore.getValue(
            target.panelId,
            target.path
          ) as boolean;
          DevTweaksStore.updateValue(
            target.panelId,
            target.path,
            !currentValue
          );
        }
      }

      // Reset mouse tracking when a new key is pressed (for move/drag)
      if (!wasAlreadyHeld) {
        lastMouseXRef.current = null;
        dragAccumulatorRef.current = 0;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      activeKeysRef.current.delete(key);

      // Reset drag state when key is released
      isDraggingRef.current = false;
      lastMouseXRef.current = null;
      dragAccumulatorRef.current = 0;

      if (activeKeysRef.current.size === 0) {
        setActiveShortcut({ activePanelId: null, activePath: null });
      } else {
        let found = false;
        for (const remainingKey of activeKeysRef.current) {
          const modifier = getActiveModifier(e);
          const target = DevTweaksStore.resolveShortcutTarget(
            remainingKey,
            modifier
          );
          if (target) {
            setActiveShortcut({
              activePanelId: target.panelId,
              activePath: target.path,
            });
            found = true;
            break;
          }
        }
        if (!found) {
          setActiveShortcut({ activePanelId: null, activePath: null });
        }
      }
    };

    // ── Scroll: key+scroll and scroll-only ──
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
    const handleWheel = (e: WheelEvent) => {
      if (isInputFocused()) {
        return;
      }

      const modifier = getActiveModifier(e);

      // Key+scroll shortcuts
      if (activeKeysRef.current.size > 0) {
        for (const key of activeKeysRef.current) {
          const target = DevTweaksStore.resolveShortcutTarget(key, modifier);
          if (!target) {
            continue;
          }

          const { panelId, path, control } = target;
          const shortcut = control.shortcut;
          if (!shortcut) {
            continue;
          }
          const interaction = shortcut.interaction ?? "scroll";
          if (interaction !== "scroll" || control.type !== "slider") {
            continue;
          }

          e.preventDefault();
          const effectiveStep = getEffectiveStep(control, shortcut);
          const direction = e.deltaY > 0 ? -1 : 1;
          applySliderDelta(panelId, path, control, effectiveStep, direction);
          return;
        }
      }

      // Scroll-only shortcuts (no key needed)
      const scrollOnlyTargets = DevTweaksStore.resolveScrollOnlyTargets();
      for (const { panelId, path, control, shortcut } of scrollOnlyTargets) {
        if (control.type !== "slider") {
          continue;
        }

        e.preventDefault();
        const effectiveStep = getEffectiveStep(control, shortcut);
        const direction = e.deltaY > 0 ? -1 : 1;
        applySliderDelta(panelId, path, control, effectiveStep, direction);
        return;
      }
    };

    // ── Drag: key+mousedown starts, mousemove adjusts, mouseup stops ──
    const handleMouseDown = (e: MouseEvent) => {
      if (isInputFocused()) {
        return;
      }
      if (activeKeysRef.current.size === 0) {
        return;
      }

      const target = resolveActiveTarget("drag");
      if (target) {
        isDraggingRef.current = true;
        lastMouseXRef.current = e.clientX;
        dragAccumulatorRef.current = 0;
        e.preventDefault();
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      lastMouseXRef.current = null;
      dragAccumulatorRef.current = 0;
    };

    // ── Move + Drag: mousemove handles both ──
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
    const handleMouseMove = (e: MouseEvent) => {
      if (isInputFocused()) {
        return;
      }
      if (activeKeysRef.current.size === 0) {
        return;
      }

      // Drag interaction (requires mousedown)
      if (isDraggingRef.current) {
        const target = resolveActiveTarget("drag");
        if (target && lastMouseXRef.current !== null) {
          const deltaX = e.clientX - lastMouseXRef.current;
          lastMouseXRef.current = e.clientX;
          dragAccumulatorRef.current += deltaX;

          const effectiveStep = getEffectiveStep(
            target.control,
            target.shortcut
          );
          const steps = Math.trunc(
            dragAccumulatorRef.current / DRAG_SENSITIVITY
          );
          if (steps !== 0) {
            dragAccumulatorRef.current -= steps * DRAG_SENSITIVITY;
            applySliderDelta(
              target.panelId,
              target.path,
              target.control,
              effectiveStep,
              steps
            );
          }
        }
        return;
      }

      // Move interaction (no click needed, just key held + mouse movement)
      const moveTarget = resolveActiveTarget("move");
      if (moveTarget) {
        if (lastMouseXRef.current === null) {
          lastMouseXRef.current = e.clientX;
          return;
        }

        const deltaX = e.clientX - lastMouseXRef.current;
        lastMouseXRef.current = e.clientX;
        dragAccumulatorRef.current += deltaX;

        const effectiveStep = getEffectiveStep(
          moveTarget.control,
          moveTarget.shortcut
        );
        const steps = Math.trunc(dragAccumulatorRef.current / DRAG_SENSITIVITY);
        if (steps !== 0) {
          dragAccumulatorRef.current -= steps * DRAG_SENSITIVITY;
          applySliderDelta(
            moveTarget.panelId,
            moveTarget.path,
            moveTarget.control,
            effectiveStep,
            steps
          );
        }
      }
    };

    const handleWindowBlur = () => {
      activeKeysRef.current.clear();
      isDraggingRef.current = false;
      lastMouseXRef.current = null;
      dragAccumulatorRef.current = 0;
      setActiveShortcut({ activePanelId: null, activePath: null });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [resolveActiveTarget]);

  return (
    <ShortcutContext.Provider value={activeShortcut}>
      {children}
    </ShortcutContext.Provider>
  );
}
