import {
  AppInput,
  type AppInputProps,
} from "@workspace/ui/components/app-input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

type AppInputFieldProps = Omit<
  AppInputProps,
  "aria-describedby" | "aria-invalid" | "className"
> & {
  "aria-describedby"?: string;
  "aria-invalid"?: AppInputProps["aria-invalid"];
  className?: string;
  description?: ReactNode;
  descriptionId?: string;
  error?: ReactNode;
  errorId?: string;
  inputClassName?: string;
  label: ReactNode;
  labelClassName?: string;
};

function AppInputField({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  description,
  descriptionId,
  error,
  errorId,
  id,
  inputClassName,
  label,
  labelClassName,
  ...props
}: AppInputFieldProps) {
  const resolvedDescriptionId =
    descriptionId ?? (id == null ? undefined : `${id}-description`);
  const resolvedErrorId = errorId ?? (id == null ? undefined : `${id}-error`);
  const describedBy = [
    ariaDescribedBy,
    description == null ? undefined : resolvedDescriptionId,
    error == null ? undefined : resolvedErrorId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Field className={cn("gap-2", className)} data-slot="app-input-field">
      <FieldLabel
        className={cn("text-foreground leading-none", labelClassName)}
        htmlFor={id}
      >
        {label}
      </FieldLabel>
      <AppInput
        aria-describedby={describedBy || undefined}
        aria-invalid={error == null ? ariaInvalid : true}
        className={inputClassName}
        id={id}
        {...props}
      />
      {description == null ? null : (
        <FieldDescription id={resolvedDescriptionId}>
          {description}
        </FieldDescription>
      )}
      {error == null ? null : (
        <FieldError
          className="text-xs leading-4"
          id={resolvedErrorId}
          role="alert"
        >
          {error}
        </FieldError>
      )}
    </Field>
  );
}

export type { AppInputFieldProps };
export { AppInputField };
