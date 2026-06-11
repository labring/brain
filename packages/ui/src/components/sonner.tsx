"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
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
        error: <OctagonXIcon className="size-4" />,
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
        } as CSSProperties
      }
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        classNames: {
          toast:
            "cn-toast min-w-0 border-t-[0.5px] border-l-[0.5px] !shadow-[0px_2px_4px_0px_rgba(8,10,17,0.25),inset_-1px_-1px_4px_0px_rgba(8,10,17,0.25)] backdrop-blur-lg",
          title: "min-w-0 text-xs font-normal leading-4",
          description: "min-w-0 text-primary/70 text-xs leading-4",
          icon: "text-primary/80",
          content: "min-w-0",
          success: "[&_[data-icon]]:text-primary/80",
          info: "[&_[data-icon]]:text-primary/80",
          warning: "[&_[data-icon]]:text-primary/80",
          error: "[&_[data-icon]]:text-primary/80",
          loading: "[&_[data-icon]]:text-primary/80",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
