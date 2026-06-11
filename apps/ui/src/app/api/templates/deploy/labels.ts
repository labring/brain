import {
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_MANAGED_BY_VALUE,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_RESOURCE_KIND_LABEL,
  BRAIN_RESOURCE_NAME_LABEL,
} from "@/lib/brain-labels";

export function templateDeploymentExtraLabels(input: {
  projectId: string;
  templateName: string;
}) {
  return {
    [BRAIN_MANAGED_BY_LABEL]: BRAIN_MANAGED_BY_VALUE,
    [BRAIN_PROJECT_ID_LABEL]: input.projectId,
    [BRAIN_RESOURCE_KIND_LABEL]: "template",
    [BRAIN_RESOURCE_NAME_LABEL]: input.templateName,
  };
}
