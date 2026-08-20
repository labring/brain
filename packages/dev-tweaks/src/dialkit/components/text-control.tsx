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
    <div className="dialkit-text-control">
      <label className="dialkit-text-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        className="dialkit-text-input"
        id={inputId}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </div>
  );
}
