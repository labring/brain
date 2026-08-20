// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
interface TextControlProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextControl({ label, value, onChange, placeholder }: TextControlProps) {
  return (
    <div className="dialkit-text-control">
      <label className="dialkit-text-label">{label}</label>
      <input
        type="text"
        className="dialkit-text-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
