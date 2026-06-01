import { AppDialog } from "@workspace/ui/components/app-dialog";
import React from "react";

interface ConfirmationModalProps {
  cancelText?: string;
  confirmText?: string;
  isDestructive?: boolean;
  isOpen: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  verificationLabel?: string;
  verificationText?: string;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  isDestructive = false,
  verificationText,
  verificationLabel,
}: ConfirmationModalProps) {
  const [inputValue, setInputValue] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const resolvedCancelText = cancelText ?? "Cancel";
  const resolvedConfirmText = confirmText ?? "Confirm";

  React.useEffect(() => {
    if (isOpen) {
      setInputValue("");
      setIsLoading(false);
    }
  }, [isOpen]);

  const isConfirmDisabled =
    (verificationText && inputValue !== verificationText) || isLoading;

  const handleConfirm = async () => {
    if (isConfirmDisabled) {
      return;
    }

    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppDialog.Root
      onOpenChange={(open) => {
        if (isLoading && !open) {
          return;
        }
        if (!open) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <AppDialog.Content aria-describedby={undefined}>
        <AppDialog.Header>
          {isDestructive ? <AppDialog.WarningIcon /> : null}
          <AppDialog.Title>{title}</AppDialog.Title>
        </AppDialog.Header>

        <AppDialog.Body>
          <div className="rounded-lg border border-red-400/15 bg-red-400/10 p-4 font-medium text-red-200 text-sm/5">
            {message}
          </div>

          {verificationText && (
            <AppDialog.Field>
              <AppDialog.Label>
                {verificationLabel ?? `Type ${verificationText} to confirm.`}
              </AppDialog.Label>
              <AppDialog.Input
                className="font-mono"
                onChange={(e) => setInputValue(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                placeholder={verificationText}
                type="text"
                value={inputValue}
              />
            </AppDialog.Field>
          )}
        </AppDialog.Body>

        <AppDialog.Footer>
          <AppDialog.Cancel disabled={isLoading}>
            {resolvedCancelText}
          </AppDialog.Cancel>
          {isDestructive ? (
            <AppDialog.DestructiveAction
              disabled={isConfirmDisabled}
              loading={isLoading}
              loadingLabel="Processing..."
              onClick={handleConfirm}
            >
              {resolvedConfirmText}
            </AppDialog.DestructiveAction>
          ) : (
            <AppDialog.Action
              disabled={isConfirmDisabled}
              loading={isLoading}
              loadingLabel="Processing..."
              onClick={handleConfirm}
            >
              {resolvedConfirmText}
            </AppDialog.Action>
          )}
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
