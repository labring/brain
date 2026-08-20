import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DialStore, type ShortcutConfig } from "../store/dial-store";

interface ShortcutsMenuProps {
  panelId: string;
}

function formatModifier(modifier: ShortcutConfig["modifier"]): string {
  if (modifier === "alt") {
    return "⌥";
  }
  if (modifier === "shift") {
    return "⇧";
  }
  if (modifier === "meta") {
    return "⌘";
  }
  return "";
}

function formatShortcutKey(sc: ShortcutConfig): string {
  if (!sc.key) {
    return "—";
  }
  const mod = formatModifier(sc.modifier);
  return `${mod}${sc.key.toUpperCase()}`;
}

function formatInteraction(sc: ShortcutConfig): string {
  const interaction = sc.interaction ?? "scroll";
  switch (interaction) {
    case "scroll":
      return sc.key ? "key+scroll" : "scroll";
    case "drag":
      return "key+drag";
    case "move":
      return "key+move";
    case "scroll-only":
      return "scroll";
    default:
      return "scroll";
  }
}

export function ShortcutsMenu({ panelId }: ShortcutsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const open = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Close on mousedown outside
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

  const panel = DialStore.getPanel(panelId);
  if (!panel) {
    return null;
  }

  const shortcuts = Object.entries(panel.shortcuts);
  if (shortcuts.length === 0) {
    return null;
  }

  // Build shortcut rows with labels from controls
  const rows = shortcuts.map(([path, shortcut]) => {
    // Find control label
    const findLabel = (controls: typeof panel.controls): string => {
      for (const c of controls) {
        if (c.path === path) {
          return c.label;
        }
        if (c.type === "folder" && c.children) {
          const found = findLabel(c.children);
          if (found) {
            return found;
          }
        }
      }
      return path;
    };
    return {
      path,
      shortcut,
      label: findLabel(panel.controls),
    };
  });

  return (
    <>
      <motion.button
        className="dialkit-shortcuts-trigger"
        onClick={toggle}
        ref={triggerRef}
        title="Keyboard shortcuts"
        transition={{ type: "spring", visualDuration: 0.15, bounce: 0.3 }}
        whileTap={{ scale: 0.9 }}
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
          <rect height="12" rx="2" width="20" x="2" y="6" />
          <path d="M6 10H6.01" />
          <path d="M10 10H10.01" />
          <path d="M14 10H14.01" />
          <path d="M18 10H18.01" />
          <path d="M8 14H16" />
        </svg>
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="dialkit-root dialkit-shortcuts-dropdown"
              exit={{
                opacity: 0,
                y: 4,
                scale: 0.97,
                pointerEvents: "none",
              }}
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              ref={dropdownRef}
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              transition={{ type: "spring", visualDuration: 0.15, bounce: 0 }}
            >
              <div className="dialkit-shortcuts-title">Keyboard Shortcuts</div>
              <div className="dialkit-shortcuts-list">
                {rows.map((row) => (
                  <div className="dialkit-shortcuts-row" key={row.path}>
                    <span className="dialkit-shortcuts-row-key">
                      {formatShortcutKey(row.shortcut)}
                    </span>
                    <span className="dialkit-shortcuts-row-label">
                      {row.label}
                    </span>
                    <span className="dialkit-shortcuts-row-mode">
                      {formatInteraction(row.shortcut)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="dialkit-shortcuts-hint">
                See pill badges on controls for keys
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
