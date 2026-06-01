import { cn } from "@data-browser/lib/utils";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AlertCircle, CheckCircle, Info } from "lucide-react";

interface AlertModalProps {
  buttonText?: string;
  isOpen: boolean;
  message: string;
  onClose: () => void;
  title: string;
  type?: "success" | "error" | "info";
}

export function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  type = "info",
  buttonText,
}: AlertModalProps) {
  const resolvedButtonText = buttonText ?? "OK";

  const getIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircle aria-hidden className="text-green-400" />;
      case "error":
        return <AlertCircle aria-hidden className="text-red-400" />;
      default:
        return <Info aria-hidden className="text-sky-400" />;
    }
  };

  return (
    <AppDialog.Root
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <AppDialog.Content aria-describedby={undefined} size="sm">
        <AppDialog.Header>
          <AppDialog.Icon
            className={cn(
              type === "success" && "text-green-400",
              type === "error" && "text-red-400",
              type === "info" && "text-sky-400"
            )}
          >
            {getIcon()}
          </AppDialog.Icon>
          <AppDialog.Title>{title}</AppDialog.Title>
        </AppDialog.Header>

        <AppDialog.Body>
          <div
            className={cn(
              "whitespace-pre-wrap rounded-lg border p-4 font-medium text-sm/5",
              type === "success" &&
                "border-green-400/15 bg-green-400/10 text-green-200",
              type === "error" &&
                "border-red-400/15 bg-red-400/10 text-red-200",
              type === "info" &&
                "border-white/10 bg-white/[0.045] text-zinc-300"
            )}
          >
            {message}
          </div>
        </AppDialog.Body>

        <AppDialog.Footer>
          {type === "error" ? (
            <AppDialog.DestructiveAction onClick={onClose}>
              {resolvedButtonText}
            </AppDialog.DestructiveAction>
          ) : (
            <AppDialog.Action onClick={onClose}>
              {resolvedButtonText}
            </AppDialog.Action>
          )}
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
