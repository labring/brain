/* eslint-disable react-hooks/set-state-in-effect -- ported DialKit render-update patterns kept structurally intact */
import { useEffect, useRef, useState } from "react";

interface ColorControlProps {
  label: string;
  onChange: (value: string) => void;
  value: string;
}

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export function ColorControl({ label, value, onChange }: ColorControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync editValue when value changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  function handleTextSubmit() {
    setIsEditing(false);
    if (HEX_COLOR_REGEX.test(editValue)) {
      onChange(editValue);
    } else {
      setEditValue(value);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleTextSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(value);
    }
  }

  return (
    <div className="dialkit-color-control">
      <span className="dialkit-color-label">{label}</span>
      <div className="dialkit-color-inputs">
        {isEditing ? (
          <input
            autoFocus
            className="dialkit-color-hex-input"
            onBlur={handleTextSubmit}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            type="text"
            value={editValue}
          />
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: DialKit CSS styles the hex readout as a span; button semantics come from role + keyboard handler
          <span
            className="dialkit-color-hex"
            onClick={() => setIsEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsEditing(true);
              }
            }}
            role="button"
            tabIndex={0}
          >
            {(value ?? "").toUpperCase()}
          </span>
        )}
        <button
          className="dialkit-color-swatch"
          onClick={() => colorInputRef.current?.click()}
          style={{ backgroundColor: value }}
          title="Pick color"
          type="button"
        />
        <input
          className="dialkit-color-picker-native"
          onChange={(e) => onChange(e.target.value)}
          ref={colorInputRef}
          type="color"
          value={
            value.length === 4 ? expandShorthandHex(value) : value.slice(0, 7)
          }
        />
      </div>
    </div>
  );
}

function expandShorthandHex(hex: string): string {
  if (hex.length !== 4) {
    return hex;
  }
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}
