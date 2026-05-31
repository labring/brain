import { cn } from "@data-browser/lib/utils";
import { AlertCircle, CheckCircle, Info } from "lucide-react";
import { Button } from "./Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

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
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Info className="h-5 w-5 text-primary" />;
    }
  };

  const getButtonVariant = () => {
    switch (type) {
      case "success":
        return "default" as const;
      case "error":
        return "destructive" as const;
      default:
        return "default" as const;
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-sm gap-0 p-0"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between gap-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6">
          <div
            className={cn(
              "whitespace-pre-wrap rounded-lg border p-4 font-medium text-sm",
              type === "success" &&
                "border-green-500/10 bg-green-500/5 text-green-500",
              type === "error" &&
                "border-destructive/10 bg-destructive/5 text-destructive",
              type === "info" &&
                "border-border bg-muted/50 text-muted-foreground"
            )}
          >
            {message}
          </div>
        </div>

        <DialogFooter className="rounded-b-xl border-t bg-muted/20 px-6 py-4">
          <Button
            className="min-w-[80px]"
            onClick={onClose}
            variant={getButtonVariant()}
          >
            {resolvedButtonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
