// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
import { useState, useRef, useEffect } from 'react';

interface ColorControlProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
    if (e.key === 'Enter') {
      handleTextSubmit();
    } else if (e.key === 'Escape') {
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
            type="text"
            className="dialkit-color-hex-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleTextSubmit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span
            className="dialkit-color-hex"
            onClick={() => setIsEditing(true)}
          >
            {(value ?? '').toUpperCase()}
          </span>
        )}
        <button
          className="dialkit-color-swatch"
          style={{ backgroundColor: value }}
          onClick={() => colorInputRef.current?.click()}
          title="Pick color"
        />
        <input
          ref={colorInputRef}
          type="color"
          className="dialkit-color-picker-native"
          value={value.length === 4 ? expandShorthandHex(value) : value.slice(0, 7)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function expandShorthandHex(hex: string): string {
  if (hex.length !== 4) return hex;
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}
