import type { Alert } from "@data-browser/components/database/shared/types";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AlertCircle, CheckCircle, Info } from "lucide-react";
import { useEffect, useState } from "react";

interface DbAccessAlertDialogProps {
  alert: Alert | null;
  onClose: () => void;
}

const ALERT_ICON = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle,
} satisfies Record<Alert["type"], typeof AlertCircle>;

export function DbAccessAlertDialog({
  alert,
  onClose,
}: DbAccessAlertDialogProps) {
  const Icon = alert ? ALERT_ICON[alert.type] : Info;

  return (
    <AppDialog.Root
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={alert !== null}
    >
      <AppDialog.Content aria-describedby={undefined} size="sm">
        <AppDialog.Header>
          <AppDialog.Icon
            className={
              alert?.type === "error"
                ? "text-red-400"
                : alert?.type === "success"
                  ? "text-green-400"
                  : "text-blue-400"
            }
          >
            <Icon aria-hidden />
          </AppDialog.Icon>
          <AppDialog.Title>{alert?.title ?? ""}</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <p className="text-sm/5 text-zinc-300">{alert?.message ?? ""}</p>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Action onClick={onClose}>{"Close"}</AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

interface DbAccessConfirmationDialogProps {
  cancelText?: string;
  confirmText?: string;
  isDestructive?: boolean;
  isOpen: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  verificationLabel?: string;
  verificationText?: string;
}

export function DbAccessConfirmationDialog({
  cancelText = "Cancel",
  confirmText = "Confirm",
  isDestructive = false,
  isOpen,
  message,
  onClose,
  onConfirm,
  title,
  verificationLabel,
  verificationText,
}: DbAccessConfirmationDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInputValue("");
      setIsLoading(false);
    }
  }, [isOpen]);

  const isConfirmDisabled =
    isLoading ||
    (verificationText !== undefined && inputValue !== verificationText);

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
          {verificationText ? (
            <AppDialog.Field>
              <AppDialog.Label>
                {verificationLabel ?? `Type ${verificationText} to confirm.`}
              </AppDialog.Label>
              <AppDialog.Input
                className="font-mono"
                onChange={(event) => setInputValue(event.target.value)}
                onPaste={(event) => event.preventDefault()}
                placeholder={verificationText}
                type="text"
                value={inputValue}
              />
            </AppDialog.Field>
          ) : null}
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={isLoading}>{cancelText}</AppDialog.Cancel>
          {isDestructive ? (
            <AppDialog.DestructiveAction
              disabled={isConfirmDisabled}
              loading={isLoading}
              loadingLabel="Processing..."
              onClick={handleConfirm}
            >
              {confirmText}
            </AppDialog.DestructiveAction>
          ) : (
            <AppDialog.Action
              disabled={isConfirmDisabled}
              loading={isLoading}
              loadingLabel="Processing..."
              onClick={handleConfirm}
            >
              {confirmText}
            </AppDialog.Action>
          )}
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
