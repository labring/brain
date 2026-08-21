import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getDevTweaksPortalRoot,
  getDropdownPosition,
} from "../dropdown-position";
import { ICON_CHEVRON } from "../icons";

type SelectOption = string | { value: string; label: string };

interface SelectControlProps {
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeOptions(
  options: SelectOption[]
): { value: string; label: string }[] {
  return options.map((opt) =>
    typeof opt === "string" ? { value: opt, label: toTitleCase(opt) } : opt
  );
}

export function SelectControl({
  label,
  value,
  options,
  onChange,
}: SelectControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    above: boolean;
  } | null>(null);
  const normalized = normalizeOptions(options);
  const selectedOption = normalized.find((o) => o.value === value);

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!(el && portalTarget)) {
      return;
    }
    // Estimate dropdown height: 8px padding + 36px per option
    const dropdownHeight = 8 + normalized.length * 36;
    setPos(getDropdownPosition(el, portalTarget, { dropdownHeight }));
  }, [normalized.length, portalTarget]);

  // Resolve portal target (closest .dev-tweaks-root)
  useEffect(() => {
    setPortalTarget(
      getDevTweaksPortalRoot(triggerRef.current) ?? document.body
    );
  }, []);

  // Position dropdown when opening
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    updatePos();
  }, [isOpen, updatePos]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  return (
    <div className="dev-tweaks-select-row">
      <button
        className="dev-tweaks-select-trigger"
        data-open={String(isOpen)}
        onClick={() => setIsOpen(!isOpen)}
        ref={triggerRef}
        type="button"
      >
        <span className="dev-tweaks-select-label">{label}</span>
        <div className="dev-tweaks-select-right">
          <span className="dev-tweaks-select-value">
            {selectedOption?.label ?? value}
          </span>
          <motion.svg
            animate={{ rotate: isOpen ? 180 : 0 }}
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
        </div>
      </button>

      {portalTarget &&
        createPortal(
          <AnimatePresence>
            {isOpen && pos && (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="dev-tweaks-select-dropdown"
                exit={{ opacity: 0, y: pos.above ? 8 : -8, scale: 0.95 }}
                initial={{ opacity: 0, y: pos.above ? 8 : -8, scale: 0.95 }}
                ref={dropdownRef}
                style={{
                  position: "absolute",
                  left: pos.left,
                  top: pos.top,
                  width: pos.width,
                  transformOrigin: pos.above ? "bottom" : "top",
                }}
                transition={{ type: "spring", visualDuration: 0.15, bounce: 0 }}
              >
                {normalized.map((option) => (
                  <button
                    className="dev-tweaks-select-option"
                    data-selected={String(option.value === value)}
                    key={option.value}
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          portalTarget
        )}
    </div>
  );
}
