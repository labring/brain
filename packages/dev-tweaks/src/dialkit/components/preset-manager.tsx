import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ICON_CHEVRON, ICON_TRASH } from "../icons";
import { DialStore, type Preset } from "../store/dial-store";

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
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const hasPresets = presets.length > 0;
  const activePreset = presets.find((p) => p.id === activePresetId);

  const open = useCallback(() => {
    if (!hasPresets) {
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setIsOpen(true);
  }, [hasPresets]);

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
      DialStore.loadPreset(panelId, presetId);
    } else {
      DialStore.clearActivePreset(panelId);
    }
    close();
  };

  const handleDelete = (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    DialStore.deletePreset(panelId, presetId);
  };

  return (
    <div className="dialkit-preset-manager">
      <button
        className="dialkit-preset-trigger"
        data-disabled={String(!hasPresets)}
        data-has-preset={String(!!activePreset)}
        data-open={String(isOpen)}
        onClick={toggle}
        ref={triggerRef}
        type="button"
      >
        <span className="dialkit-preset-label">
          {activePreset ? activePreset.name : "Version 1"}
        </span>
        <motion.svg
          animate={{
            rotate: isOpen ? 180 : 0,
            opacity: hasPresets ? 0.6 : 0.25,
          }}
          className="dialkit-select-chevron"
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

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="dialkit-root dialkit-preset-dropdown"
              exit={{
                opacity: 0,
                y: 4,
                scale: 0.97,
                pointerEvents: "none" as React.CSSProperties["pointerEvents"],
              }}
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                minWidth: pos.width,
              }}
              transition={{ type: "spring", visualDuration: 0.15, bounce: 0 }}
            >
              {/* biome-ignore lint/a11y/useSemanticElements: DialKit CSS styles preset rows as divs; button semantics come from role + keyboard handler */}
              <div
                className="dialkit-preset-item"
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
                <span className="dialkit-preset-name">Version 1</span>
              </div>

              {presets.map((preset) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: preset row hosts a nested delete button, so role="button" would nest controls invalidly
                // biome-ignore lint/a11y/noNoninteractiveElementInteractions: preset row hosts a nested delete button, so role="button" would nest controls invalidly
                // biome-ignore lint/a11y/useKeyWithClickEvents: preset row hosts a nested delete button, so role="button" would nest controls invalidly
                <div
                  className="dialkit-preset-item"
                  data-active={String(preset.id === activePresetId)}
                  key={preset.id}
                  onClick={() => handleSelect(preset.id)}
                >
                  <span className="dialkit-preset-name">{preset.name}</span>
                  <button
                    className="dialkit-preset-delete"
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
        document.body
      )}
    </div>
  );
}
