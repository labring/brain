"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      className="toaster group"
      closeButton={false}
      duration={4000}
      gap={8}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <CircleAlertIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      mobileOffset={16}
      offset={16}
      position="top-center"
      style={
        {
          "--normal-bg": "color-mix(in oklab, var(--input) 30%, transparent)",
          "--normal-text": "var(--primary)",
          "--normal-border":
            "color-mix(in oklab, var(--border) 70%, transparent)",
          "--border-radius": "var(--radius-lg)",
          "--toast-icon-margin-end": "0px",
          "--toast-icon-margin-start": "0px",
          "--toast-svg-margin-end": "0px",
          "--toast-svg-margin-start": "0px",
          "--width": "min(27rem, calc(100vw - 2rem))",
        } as CSSProperties
      }
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        classNames: {
          toast:
            "cn-toast min-w-0 !items-start !gap-2.5 border-t-[0.5px] border-l-[0.5px] !p-2.5 !shadow-[0px_2px_4px_0px_rgba(8,10,17,0.25),inset_-1px_-1px_4px_0px_rgba(8,10,17,0.25)] backdrop-blur-lg",
          title:
            "min-w-0 break-words !text-sm !font-normal !leading-5 !text-primary",
          description:
            "min-w-0 break-words !text-sm !font-normal !leading-5 !text-primary",
          icon: "!m-0 !flex !size-9 shrink-0 !items-center !justify-center rounded-lg bg-input/30 text-primary/80 [&>svg]:!m-0 [&>svg]:size-4",
          content: "min-w-0 flex-1 !gap-0",
          success: "[&_[data-icon]]:text-primary/80",
          info: "[&_[data-icon]]:text-primary/80",
          warning: "[&_[data-icon]]:text-primary/80",
          error: "[&_[data-icon]]:!text-red-500",
          loading: "[&_[data-icon]]:text-primary/80",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
