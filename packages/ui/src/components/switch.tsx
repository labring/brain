"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@workspace/ui/lib/utils";

function Switch({
  className,
  size = "default",
  variant = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default" | "lg";
  variant?: "default" | "brand";
}) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-[3px] border-transparent bg-input outline-none transition-colors after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=lg]:h-6 data-[size=sm]:h-4 data-[size=default]:w-9 data-[size=lg]:w-11 data-[size=sm]:w-7 data-disabled:cursor-not-allowed data-checked:bg-blue-500 data-disabled:opacity-50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      data-size={size}
      data-slot="switch"
      data-variant={variant}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-primary shadow-lg ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=lg]/switch:size-5 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[14px] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=lg]/switch:data-checked:translate-x-[18px] group-data-[size=lg]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-checked:translate-x-2.5 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
