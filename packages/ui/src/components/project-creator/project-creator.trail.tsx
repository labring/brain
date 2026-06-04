"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowLeft } from "lucide-react";

import { useProjectCreator } from "./project-creator.context";
import { PROJECT_CREATOR_SOURCE_LABEL } from "./project-creator.types";

export function ProjectCreatorTrail({ className }: { className?: string }) {
  const {
    actions: { reset },
    states: { step },
  } = useProjectCreator("ProjectCreator.Trail");

  if (step === null) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3",
        className
      )}
      data-slot="project-creator-trail"
    >
      <AppButton
        className="-ml-2 text-muted-foreground hover:text-foreground"
        onClick={reset}
        type="button"
        variant="quiet"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back
      </AppButton>
      <p className="min-w-0 truncate font-medium text-muted-foreground text-xs">
        {PROJECT_CREATOR_SOURCE_LABEL[step]}
      </p>
    </div>
  );
}
