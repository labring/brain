import { motion } from "motion/react";
import { useCallback, useSyncExternalStore } from "react";
import { ICON_TIMELINE } from "../../icons";
import { TimelineUiStore } from "../../store/timeline-ui-store";

export function TimelineToggleButton() {
  const subscribe = useCallback(
    (listener: () => void) => TimelineUiStore.subscribe(listener),
    []
  );
  const getVisible = useCallback(() => TimelineUiStore.getVisible(), []);
  const visible = useSyncExternalStore(subscribe, getVisible, getVisible);
  const label = visible ? "Hide timeline" : "Show timeline";

  return (
    <motion.button
      aria-label={label}
      aria-pressed={visible}
      className="dialkit-toolbar-add dialkit-timeline-toolbar-toggle"
      data-active={visible || undefined}
      onClick={() => TimelineUiStore.toggle()}
      title={label}
      transition={{ type: "spring", visualDuration: 0.15, bounce: 0.3 }}
      whileTap={{ scale: 0.9 }}
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        {ICON_TIMELINE.map((d) => (
          <path d={d} fill="currentColor" key={d} />
        ))}
      </svg>
    </motion.button>
  );
}
