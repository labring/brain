import type { Alert } from "@data-browser/components/database/shared/types";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AlertCircle, CheckCircle, Info } from "lucide-react";

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
