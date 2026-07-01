"use client";

import { SidePane } from "@workspace/ui/components/side-pane";
import { Wrench } from "lucide-react";

import { SealosSkillsWorkflowContent } from "./sealos-skills-workflow-content";

export function SealosSkillsWorkflowPane({ onClose }: { onClose: () => void }) {
  return (
    <SidePane
      bodyClassName="gap-5 pt-0"
      closeAriaLabel="Close Sealos Skills workflow pane"
      icon={<Wrench aria-hidden className="size-4 text-blue-400" />}
      label="Sealos Skills workflow pane"
      onClose={onClose}
      subtitle="Set up locally and deploy automatically in 6 steps."
      title="Sealos Skills Workflow"
    >
      <SealosSkillsWorkflowContent />
    </SidePane>
  );
}
