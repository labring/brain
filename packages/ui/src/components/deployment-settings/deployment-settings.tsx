"use client";

import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

function DeploymentSettingsSection({
  action,
  children,
  className,
  description,
  icon,
  title,
  ...props
}: ComponentPropsWithoutRef<"section"> & {
  action?: ReactNode;
  description?: ReactNode;
  icon: ReactNode;
  title: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-input/30 p-4",
        className
      )}
      {...props}
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-4 shrink-0 items-center justify-center text-foreground">
              {icon}
            </span>
            <h3 className="truncate font-medium text-foreground text-sm leading-5">
              {title}
            </h3>
          </div>
          {description == null ? null : (
            <p className="text-muted-foreground text-sm leading-5">
              {description}
            </p>
          )}
        </div>
        {action == null ? null : (
          <div className="flex shrink-0 items-center gap-1">{action}</div>
        )}
      </header>
      {children}
    </section>
  );
}

function DeploymentSettingsControl({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      {children}
    </div>
  );
}

function DeploymentSettingsGroupHeader({
  action,
  className,
  title,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  action?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-2",
        className
      )}
      {...props}
    >
      <p className="font-medium text-foreground text-sm leading-5">{title}</p>
      {action == null ? null : (
        <div className="flex shrink-0 items-center gap-1">{action}</div>
      )}
    </div>
  );
}

function DeploymentSettingsField({
  children,
  className,
  label,
  labelClassName,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  label: ReactNode;
  labelClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props}>
      <Label className={labelClassName}>{label}</Label>
      {children}
    </div>
  );
}

export const DeploymentSettings = {
  Control: DeploymentSettingsControl,
  Field: DeploymentSettingsField,
  GroupHeader: DeploymentSettingsGroupHeader,
  Section: DeploymentSettingsSection,
};
