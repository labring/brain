interface ButtonGroupProps {
  buttons: Array<{
    label: string;
    onClick: () => void;
  }>;
}

export function ButtonGroup({ buttons }: ButtonGroupProps) {
  return (
    <div className="dev-tweaks-button-group">
      {buttons.map((button) => (
        <button
          className="dev-tweaks-button"
          key={button.label}
          onClick={button.onClick}
          type="button"
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
