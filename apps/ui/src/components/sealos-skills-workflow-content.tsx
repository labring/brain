"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export const SEALOS_SKILLS_INSTALL_COMMAND = "npx skills add labring/seakills";

export const SEALOS_SKILLS_FLOW_STEPS = [
  {
    description:
      "Run the installation command to prepare the Sealos Skills runtime environment.",
    title: "1. Install Skills and Docker Locally",
  },
  {
    description:
      "Trigger the automated deployment workflow directly inside the current project.",
    title: '2. Run the "Deploy on Sealos" Skills Command',
  },
  {
    description:
      "Follow the instructions to bind and authenticate your local machine with your Sealos account.",
    title: "3. Complete Device Authentication",
  },
  {
    description:
      "Automatically detect the tech stack, entry command, and dependencies, then generate a buildable Dockerfile.",
    title: "4. Automatically Analyze the Project and Generate a Dockerfile",
  },
  {
    description:
      "Build the container image based on the generated configuration and prepare it for release.",
    title: "5. Automatically Build the Docker Image",
  },
  {
    description:
      "After deployment is complete, an accessible domain will be returned automatically.",
    title: "6. Automatically Deploy and Generate an Accessible Domain",
  },
] as const;

function SealosSkillsInstallCommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const [copyButtonFocused, setCopyButtonFocused] = useState(false);
  const isCommandHighlighted = copied || copyButtonFocused;

  const copyCommand = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Clipboard is not available.");
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Copied install command.");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy install command.");
    }
  }, [command]);

  return (
    <div
      className={cn(
        "group flex h-10 items-center gap-1 overflow-hidden rounded-md bg-input/30 px-3 py-2 transition-colors hover:bg-input",
        isCommandHighlighted && "bg-input"
      )}
      data-slot="sealos-skills-install-command"
    >
      <p
        className={cn(
          "min-w-0 flex-1 truncate font-normal text-muted-foreground text-sm leading-5 transition-colors group-hover:text-foreground",
          isCommandHighlighted && "text-foreground"
        )}
      >
        {command}
      </p>
      <AppIconButton
        aria-label={copied ? "Copied install command" : "Copy install command"}
        className={cn(
          "shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:bg-transparent group-hover:text-foreground",
          isCommandHighlighted && "text-foreground"
        )}
        data-copied={copied}
        onBlur={() => setCopyButtonFocused(false)}
        onClick={() => {
          copyCommand().catch(() => undefined);
        }}
        onFocus={() => setCopyButtonFocused(true)}
        size="sm"
        type="button"
        variant="quiet"
      >
        {copied ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
      </AppIconButton>
    </div>
  );
}

function SealosSkillsSectionHeader({
  className,
  description,
  title,
  titleClassName,
}: {
  className?: string;
  description: string;
  title: string;
  titleClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p
        className={cn(
          "font-medium text-primary text-sm leading-5",
          titleClassName
        )}
      >
        {title}
      </p>
      <p className="font-normal text-muted-foreground text-sm leading-5">
        {description}
      </p>
    </div>
  );
}

function SealosSkillsFlowStepCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md p-2.5 shadow-sm">
      <SealosSkillsSectionHeader description={description} title={title} />
    </div>
  );
}

export function SealosSkillsWorkflowContent({
  className,
  installCommand = SEALOS_SKILLS_INSTALL_COMMAND,
}: {
  className?: string;
  installCommand?: string;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-5", className)}
      data-slot="sealos-skills-workflow-content"
    >
      <section className="flex flex-col gap-2">
        <SealosSkillsSectionHeader
          description="Install Sealos Skills locally first."
          title="INSTALL"
          titleClassName="uppercase tracking-normal"
        />
        <SealosSkillsInstallCommandRow command={installCommand} />
      </section>

      <section className="flex flex-col gap-2">
        <SealosSkillsSectionHeader
          description="The entire deployment process will be completed automatically in the following order."
          title="Flow"
        />
        <div className="flex flex-col gap-2">
          {SEALOS_SKILLS_FLOW_STEPS.map((step) => (
            <SealosSkillsFlowStepCard
              description={step.description}
              key={step.title}
              title={step.title}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
