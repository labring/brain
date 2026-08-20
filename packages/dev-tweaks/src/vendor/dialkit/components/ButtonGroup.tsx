// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
interface ButtonGroupProps {
  buttons: Array<{
    label: string;
    onClick: () => void;
  }>;
}

export function ButtonGroup({ buttons }: ButtonGroupProps) {
  return (
    <div className="dialkit-button-group">
      {buttons.map((button, index) => (
        <button
          key={index}
          className="dialkit-button"
          onClick={button.onClick}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
