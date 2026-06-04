import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@data-browser/components/ui/dialog";
import { cn } from "@data-browser/lib/utils";
import { AppButton } from "@workspace/ui/components/app-button";
import { Button } from "@workspace/ui/components/button";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, CheckCircle, Info, Loader2, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useState,
} from "react";
import type { ModalAlert, ModalContextValue, ModalMeta } from "./types";

/** Context shared between ModalForm compound components. */
const ModalFormContext = createContext<ModalContextValue | null>(null);

/**
 * Hook for per-modal subcomponents to access the ModalForm context.
 * Throws if used outside `ModalForm.Provider`.
 *
 * Compound components (Header, Alert, Footer, etc.) use this internally.
 * Per-modal field components can also use it to read base state (e.g., `isSubmitting`).
 */
export function useModalForm(): ModalContextValue {
  const ctx = use(ModalFormContext);
  if (!ctx) {
    throw new Error("useModalForm must be used within ModalForm.Provider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Compound subcomponents
// ---------------------------------------------------------------------------

interface ModalFormProviderProps {
  children: ReactNode;
  meta: ModalMeta;
  /**
   * When provided, Provider auto-manages the submit lifecycle:
   * 1. Sets isSubmitting = true, clears alert
   * 2. Awaits onSubmit()
   * 3. On throw: sets alert with error message
   * 4. Finally: sets isSubmitting = false
   *
   * When omitted, consumer manages lifecycle via useModalForm().actions
   */
  onSubmit?: () => Promise<void>;
}

/** Provides ModalForm context to compound subcomponents. Owns isSubmitting and alert state. */
function ModalFormProvider({
  children,
  meta,
  onSubmit,
}: ModalFormProviderProps) {
  const [isSubmitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<ModalAlert | null>(null);

  const closeAlert = useCallback(() => setAlert(null), []);
  const reset = useCallback(() => {
    setSubmitting(false);
    setAlert(null);
  }, []);

  const submit = onSubmit
    ? async () => {
        setSubmitting(true);
        setAlert(null);
        try {
          await onSubmit();
        } catch (e) {
          setAlert({
            type: "error",
            title: "Error",
            message: e instanceof Error ? e.message : String(e),
          });
        } finally {
          setSubmitting(false);
        }
      }
    : undefined;

  return (
    <ModalFormContext
      value={{
        state: { isSubmitting, alert },
        actions: { submit, setSubmitting, setAlert, closeAlert, reset },
        meta,
      }}
    >
      {children}
    </ModalFormContext>
  );
}

/** Renders the modal title with optional icon and description. Uses Dialog primitives. */
function ModalFormHeader() {
  const { meta } = useModalForm();
  const Icon = meta.icon;

  return (
    <DialogHeader className={meta.description ? "-mb-2" : undefined}>
      <DialogTitle className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5" />}
        {meta.title}
      </DialogTitle>
      {meta.description && (
        <DialogDescription>{meta.description}</DialogDescription>
      )}
    </DialogHeader>
  );
}

const ALERT_ICONS: Record<ModalAlert["type"], LucideIcon> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const ALERT_STYLES: Record<ModalAlert["type"], string> = {
  success: "border-green-500/20 bg-green-500/5 text-green-500",
  error: "border-destructive/20 bg-destructive/5 text-destructive",
  info: "border-primary/20 bg-primary/5 text-primary",
};

/** Renders an inline dismissible alert banner. Returns `null` when no alert is active. */
function ModalFormAlert({ className }: { className?: string }) {
  const { state, actions } = useModalForm();
  if (!state.alert) {
    return null;
  }

  const { type, title, message } = state.alert;
  const Icon = ALERT_ICONS[type];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        ALERT_STYLES[type],
        className
      )}
      role="alert"
    >
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm opacity-80">{message}</p>
      </div>
      <Button
        className="shrink-0 opacity-70 hover:opacity-100"
        onClick={actions.closeAlert}
        size="icon-xs"
        variant="ghost"
      >
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">{"Dismiss alert"}</span>
      </Button>
    </div>
  );
}

/**
 * Layout wrapper for modal action buttons.
 * When no children are provided, renders default Cancel + Submit buttons.
 */
function ModalFormFooter({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <DialogFooter className={className}>
      {children ?? (
        <>
          <ModalFormCancelButton />
          <ModalFormSubmitButton />
        </>
      )}
    </DialogFooter>
  );
}

/** Submit button that shows a loading spinner when `isSubmitting` is true. When `actions.submit` is undefined (complex mode), accepts an `onClick` prop as fallback. */
function ModalFormSubmitButton({
  label,
  disabled,
  onClick,
}: {
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const { state, actions, meta } = useModalForm();
  const handleClick = onClick ?? actions.submit;

  return (
    <AppButton
      disabled={disabled || state.isSubmitting}
      onClick={handleClick}
      type="button"
      variant={meta.isDestructive ? "danger" : "secondary"}
    >
      {state.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
      {label ?? (meta.isDestructive ? "Delete" : "Submit")}
    </AppButton>
  );
}

/** Cancel button that closes the parent Dialog via Radix `DialogClose`. */
function ModalFormCancelButton() {
  return (
    <DialogClose asChild>
      <AppButton type="button" variant="quiet">
        {"Cancel"}
      </AppButton>
    </DialogClose>
  );
}

// ---------------------------------------------------------------------------
// Namespace export
// ---------------------------------------------------------------------------

/**
 * Compound component for composing modal UIs within the Vercel Composition Pattern.
 *
 * Usage:
 * ```tsx
 * <Dialog open={open} onOpenChange={onOpenChange}>
 *   <DialogContent>
 *     <MyModalProvider>
 *       <ModalForm.Header />
 *       <MyCustomFields />
 *       <ModalForm.Alert />
 *       <ModalForm.Footer />
 *     </MyModalProvider>
 *   </DialogContent>
 * </Dialog>
 * ```
 */
export const ModalForm = {
  Provider: ModalFormProvider,
  Header: ModalFormHeader,
  Alert: ModalFormAlert,
  Footer: ModalFormFooter,
  SubmitButton: ModalFormSubmitButton,
  CancelButton: ModalFormCancelButton,
};
