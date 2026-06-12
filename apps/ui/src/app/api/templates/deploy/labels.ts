import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_MANAGED_BY_VALUE,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
} from "@/lib/brain-labels";

export function templateDeploymentExtraLabels(input: {
  instanceName: string;
  projectId: string;
  templateName: string;
}) {
  return {
    [BRAIN_MANAGED_BY_LABEL]: BRAIN_MANAGED_BY_VALUE,
    [BRAIN_PROJECT_ID_LABEL]: input.projectId,
    [BRAIN_DEPLOYMENT_KIND_LABEL]: "template",
    [BRAIN_DEPLOYMENT_NAME_LABEL]: input.instanceName,
    [BRAIN_TEMPLATE_NAME_LABEL]: input.templateName,
  };
}
