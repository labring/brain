import { useId } from "react";

interface TextControlProps {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}

export function TextControl({
  label,
  value,
  onChange,
  placeholder,
}: TextControlProps) {
  const inputId = useId();
  return (
    <div className="dev-tweaks-text-control">
      <label className="dev-tweaks-text-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        className="dev-tweaks-text-input"
        id={inputId}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </div>
  );
}
