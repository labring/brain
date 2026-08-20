interface ButtonGroupProps {
  buttons: Array<{
    label: string;
    onClick: () => void;
  }>;
}

export function ButtonGroup({ buttons }: ButtonGroupProps) {
  return (
    <div className="dialkit-button-group">
      {buttons.map((button) => (
        <button
          className="dialkit-button"
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
