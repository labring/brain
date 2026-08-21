import { formatToggleShortcut } from "../shortcut-utils";
import type { ShortcutConfig } from "../store/dev-tweaks-store";
import { SegmentedControl } from "./segmented-control";

interface ToggleProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  shortcut?: ShortcutConfig;
  shortcutActive?: boolean;
}

export function Toggle({
  label,
  checked,
  onChange,
  shortcut,
  shortcutActive,
}: ToggleProps) {
  return (
    <div className="dev-tweaks-labeled-control">
      <span className="dev-tweaks-labeled-control-label">
        {label}
        {shortcut && (
          <span
            className={`dev-tweaks-shortcut-pill${shortcutActive ? "dev-tweaks-shortcut-pill-active" : ""}`}
          >
            {formatToggleShortcut(shortcut)}
          </span>
        )}
      </span>
      <SegmentedControl
        onChange={(val) => onChange(val === "on")}
        options={[
          { value: "off" as const, label: "Off" },
          { value: "on" as const, label: "On" },
        ]}
        value={checked ? "on" : "off"}
      />
    </div>
  );
}
