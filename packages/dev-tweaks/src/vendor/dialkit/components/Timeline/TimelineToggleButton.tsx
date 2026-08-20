// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
import { useCallback, useSyncExternalStore } from 'react';
import { motion } from 'motion/react';
import { ICON_TIMELINE } from '../../icons';
import { TimelineUiStore } from '../../store/TimelineUiStore';

export function TimelineToggleButton() {
  const subscribe = useCallback(
    (listener: () => void) => TimelineUiStore.subscribe(listener),
    []
  );
  const getVisible = useCallback(() => TimelineUiStore.getVisible(), []);
  const visible = useSyncExternalStore(subscribe, getVisible, getVisible);
  const label = visible ? 'Hide timeline' : 'Show timeline';

  return (
    <motion.button
      className="dialkit-toolbar-add dialkit-timeline-toolbar-toggle"
      data-active={visible || undefined}
      aria-pressed={visible}
      aria-label={label}
      title={label}
      onClick={() => TimelineUiStore.toggle()}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', visualDuration: 0.15, bounce: 0.3 }}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {ICON_TIMELINE.map((d, i) => <path key={i} d={d} fill="currentColor" />)}
      </svg>
    </motion.button>
  );
}
