import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { buildCopyInstruction } from "../copy-instruction";
import { ICON_ADD_PRESET, ICON_CHECK, ICON_CLIPBOARD } from "../icons";
import { DevTweaksStore, type PanelConfig } from "../store/dev-tweaks-store";
import { ControlRenderer } from "./control-renderer";
import { Folder } from "./folder";
import { PresetManager } from "./preset-manager";

interface PanelProps {
  defaultOpen?: boolean;
  /** Root variant only: fill the parent instead of sizing to content (frame posture). */
  fill?: boolean;
  /** Root variant only: chrome controls rendered in the title row. */
  headerActions?: ReactNode;
  inline?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Root variant only: controlled open state. */
  open?: boolean;
  panel: PanelConfig;
  toolbarExtra?: ReactNode;
  variant?: "root" | "section";
}

export function Panel({
  panel,
  defaultOpen = true,
  fill = false,
  headerActions,
  inline = false,
  onOpenChange,
  open,
  variant = "root",
  toolbarExtra,
}: PanelProps) {
  const [copied, setCopied] = useState(false);
  const [_isPanelOpen, setIsPanelOpen] = useState(defaultOpen);
  const _hasShortcuts = Object.keys(panel.shortcuts).length > 0;
  const subscribe = useCallback(
    (callback: () => void) => DevTweaksStore.subscribe(panel.id, callback),
    [panel.id]
  );
  const getSnapshot = useCallback(
    () => DevTweaksStore.getValues(panel.id),
    [panel.id]
  );

  // Subscribe to panel value changes
  const values = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const getPresetsSnapshot = useCallback(
    () => DevTweaksStore.getPresets(panel.id),
    [panel.id]
  );
  const getActivePresetIdSnapshot = useCallback(
    () => DevTweaksStore.getActivePresetId(panel.id),
    [panel.id]
  );
  const presets = useSyncExternalStore(
    subscribe,
    getPresetsSnapshot,
    getPresetsSnapshot
  );
  const activePresetId = useSyncExternalStore(
    subscribe,
    getActivePresetIdSnapshot,
    getActivePresetIdSnapshot
  );

  const handleAddPreset = () => {
    const nextNum = presets.length + 2;
    DevTweaksStore.savePreset(panel.id, `Version ${nextNum}`);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      buildCopyInstruction("useDevTweaks", panel.name, values)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsPanelOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange]
  );

  const renderControls = () => (
    <ControlRenderer
      controls={panel.controls}
      panelId={panel.id}
      values={values}
    />
  );

  const _iconTransition = {
    type: "spring" as const,
    visualDuration: 0.4,
    bounce: 0.1,
  };

  const toolbar = (
    <>
      <motion.button
        className="dev-tweaks-toolbar-add"
        onClick={handleAddPreset}
        title="Add preset"
        transition={{ type: "spring", visualDuration: 0.15, bounce: 0.3 }}
        whileTap={{ scale: 0.9 }}
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          {ICON_ADD_PRESET.map((d) => (
            <path d={d} key={d} />
          ))}
        </svg>
      </motion.button>

      <PresetManager
        activePresetId={activePresetId}
        onAdd={handleAddPreset}
        panelId={panel.id}
        presets={presets}
      />

      <motion.button
        className="dev-tweaks-toolbar-add"
        onClick={handleCopy}
        title="Copy parameters"
        transition={{ type: "spring", visualDuration: 0.15, bounce: 0.3 }}
        whileTap={{ scale: 0.9 }}
      >
        <span style={{ position: "relative", width: 16, height: 16 }}>
          <AnimatePresence initial={false} mode="wait">
            {copied ? (
              <motion.svg
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                fill="none"
                initial={{ scale: 0.8, opacity: 0 }}
                key="check"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: 16,
                  height: 16,
                  color: "var(--dial-text-label)",
                }}
                transition={{ duration: 0.08 }}
                viewBox="0 0 24 24"
              >
                <path d={ICON_CHECK} />
              </motion.svg>
            ) : (
              <motion.svg
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                fill="none"
                initial={{ scale: 0.8, opacity: 0 }}
                key="clipboard"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: 16,
                  height: 16,
                  color: "var(--dial-text-label)",
                }}
                transition={{ duration: 0.08 }}
                viewBox="0 0 24 24"
              >
                <path
                  d={ICON_CLIPBOARD.board}
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
                <path d={ICON_CLIPBOARD.sparkle} fill="currentColor" />
                <path
                  d={ICON_CLIPBOARD.body}
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </motion.svg>
            )}
          </AnimatePresence>
        </span>
      </motion.button>

      {toolbarExtra}
    </>
  );

  if (variant === "section") {
    return (
      <Folder
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        title={panel.name}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: click handler only stops propagation to the folder header; not an interactive control */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: click handler only stops propagation to the folder header; not an interactive control */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: click handler only stops propagation to the folder header; not an interactive control */}
        <div
          className="dev-tweaks-panel-section-toolbar"
          onClick={(e) => e.stopPropagation()}
        >
          {toolbar}
        </div>
        {renderControls()}
      </Folder>
    );
  }

  return (
    <div className="dev-tweaks-panel-wrapper">
      <Folder
        defaultOpen={defaultOpen}
        fill={fill}
        headerActions={headerActions}
        inline={inline}
        isRoot={true}
        onOpenChange={handleOpenChange}
        open={open}
        title={panel.name}
        toolbar={toolbar}
      >
        {renderControls()}
      </Folder>
    </div>
  );
}
