import { toastClassNames } from "@workspace/ui/components/sonner";
import { type ExternalToast, toast } from "sonner";

function mergeClassNames(
  ...classNames: Array<string | null | undefined>
): string | undefined {
  const merged = classNames.filter(Boolean).join(" ");
  return merged === "" ? undefined : merged;
}

function wideToastOptions(options?: ExternalToast): ExternalToast {
  return {
    ...options,
    className: mergeClassNames(toastClassNames.wide, options?.className),
  };
}

export function errorDescription(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function toastErrorDetail(
  title: string,
  description: string,
  options?: ExternalToast
) {
  const trimmedTitle = title.trim() || "Operation failed.";
  const trimmedDescription = description.trim();

  if (trimmedDescription === "" || trimmedDescription === trimmedTitle) {
    return toast.error(trimmedTitle, options);
  }

  return toast.error(trimmedTitle, {
    ...wideToastOptions(options),
    description: trimmedDescription,
  });
}

export function toastPromiseDetail<T>(
  promise: Promise<T>,
  messages: {
    errorDescription: (error: unknown) => string;
    errorTitle: string;
    loading: string;
    success: string | ((value: T) => string);
  },
  options?: ExternalToast
): void {
  const toastId = toast.loading(messages.loading, options);

  promise
    .then((value) => {
      toast.success(
        typeof messages.success === "function"
          ? messages.success(value)
          : messages.success,
        {
          ...options,
          id: toastId,
        }
      );
    })
    .catch((error) => {
      toastErrorDetail(messages.errorTitle, messages.errorDescription(error), {
        ...options,
        id: toastId,
      });
    });
}
