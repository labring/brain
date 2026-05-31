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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-all after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=lg]:h-6 data-[size=sm]:h-[14px] data-[size=default]:w-[32px] data-[size=lg]:w-11 data-[size=sm]:w-[24px] data-disabled:cursor-not-allowed data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-50 dark:data-unchecked:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        variant === "brand" &&
          "data-checked:bg-blue-500 data-unchecked:bg-zinc-700 dark:data-checked:bg-blue-500 dark:data-unchecked:bg-zinc-700",
        className
      )}
      data-size={size}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=lg]/switch:size-5 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=lg]/switch:data-checked:translate-x-5 group-data-[size=lg]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground",
          variant === "brand" &&
            "bg-zinc-100 data-checked:bg-zinc-100 data-unchecked:bg-zinc-100 dark:bg-zinc-100 dark:data-checked:bg-zinc-100 dark:data-unchecked:bg-zinc-100"
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
