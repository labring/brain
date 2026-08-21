import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type DropdownPosition,
  getDevTweaksPortalRoot,
  getDropdownPosition,
} from "../dropdown-position";
import { ICON_CHEVRON, ICON_TRASH } from "../icons";
import { DevTweaksStore, type Preset } from "../store/dev-tweaks-store";

interface PresetManagerProps {
  activePresetId: string | null;
  onAdd: () => void;
  panelId: string;
  presets: Preset[];
}

export function PresetManager({
  panelId,
  presets,
  activePresetId,
  onAdd: _onAdd,
}: PresetManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<DropdownPosition | null>(null);

  const hasPresets = presets.length > 0;
  const activePreset = presets.find((p) => p.id === activePresetId);

  // Portal into the dev-tweaks root: it rides the top layer, so a body
  // portal would paint underneath it (and the framed body clips portals).
  useEffect(() => {
    setPortalTarget(
      getDevTweaksPortalRoot(triggerRef.current) ?? document.body
    );
  }, []);

  const open = useCallback(() => {
    const el = triggerRef.current;
    if (!(hasPresets && el && portalTarget)) {
      return;
    }
    // Estimate dropdown height: 8px padding + 36px per row (base + presets)
    const dropdownHeight = 8 + (presets.length + 1) * 36;
    setPos(getDropdownPosition(el, portalTarget, { dropdownHeight }));
    setIsOpen(true);
  }, [hasPresets, portalTarget, presets.length]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Close on any mousedown outside trigger + dropdown
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, close]);

  const handleSelect = (presetId: string | null) => {
    if (presetId) {
      DevTweaksStore.loadPreset(panelId, presetId);
    } else {
      DevTweaksStore.clearActivePreset(panelId);
    }
    close();
  };

  const handleDelete = (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    DevTweaksStore.deletePreset(panelId, presetId);
  };

  return (
    <div className="dev-tweaks-preset-manager">
      <button
        className="dev-tweaks-preset-trigger"
        data-disabled={String(!hasPresets)}
        data-has-preset={String(!!activePreset)}
        data-open={String(isOpen)}
        onClick={toggle}
        ref={triggerRef}
        type="button"
      >
        <span className="dev-tweaks-preset-label">
          {activePreset ? activePreset.name : "Version 1"}
        </span>
        <motion.svg
          animate={{
            rotate: isOpen ? 180 : 0,
            opacity: hasPresets ? 0.6 : 0.25,
          }}
          className="dev-tweaks-select-chevron"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          transition={{ type: "spring", visualDuration: 0.2, bounce: 0.15 }}
          viewBox="0 0 24 24"
        >
          <path d={ICON_CHEVRON} />
        </motion.svg>
      </button>

      {portalTarget &&
        createPortal(
          <AnimatePresence>
            {isOpen && pos && (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="dev-tweaks-preset-dropdown"
                exit={{
                  opacity: 0,
                  y: pos.above ? -4 : 4,
                  scale: 0.97,
                  pointerEvents: "none" as React.CSSProperties["pointerEvents"],
                }}
                initial={{ opacity: 0, y: pos.above ? -4 : 4, scale: 0.97 }}
                ref={dropdownRef}
                style={{
                  position: "absolute",
                  top: pos.top,
                  left: pos.left,
                  minWidth: pos.width,
                  transformOrigin: pos.above ? "bottom left" : "top left",
                }}
                transition={{ type: "spring", visualDuration: 0.15, bounce: 0 }}
              >
                {/* biome-ignore lint/a11y/useSemanticElements: DevTweaks CSS styles preset rows as divs; button semantics come from role + keyboard handler */}
                <div
                  className="dev-tweaks-preset-item"
                  data-active={String(!activePresetId)}
                  onClick={() => handleSelect(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(null);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="dev-tweaks-preset-name">Version 1</span>
                </div>

                {presets.map((preset) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: preset row hosts a nested delete button, so role="button" would nest controls invalidly
                  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: preset row hosts a nested delete button, so role="button" would nest controls invalidly
                  // biome-ignore lint/a11y/useKeyWithClickEvents: preset row hosts a nested delete button, so role="button" would nest controls invalidly
                  <div
                    className="dev-tweaks-preset-item"
                    data-active={String(preset.id === activePresetId)}
                    key={preset.id}
                    onClick={() => handleSelect(preset.id)}
                  >
                    <span className="dev-tweaks-preset-name">
                      {preset.name}
                    </span>
                    <button
                      className="dev-tweaks-preset-delete"
                      onClick={(e) => handleDelete(e, preset.id)}
                      title="Delete preset"
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        {ICON_TRASH.map((d) => (
                          <path d={d} key={d} />
                        ))}
                      </svg>
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          portalTarget
        )}
    </div>
  );
}
