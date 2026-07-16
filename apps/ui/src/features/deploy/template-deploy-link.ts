import { serializeProjectSideSurfaceEntry } from "@/features/panes/url-codec";
import {
  normalizeTemplateName,
  parseTemplateForm,
} from "./template-deployment-intent";

export function templateDeployProjectPath(
  templateName: string | string[] | null | undefined,
  templateForm?: string | string[] | null
): string {
  const normalizedTemplateName =
    typeof templateName === "string"
      ? normalizeTemplateName(templateName)
      : null;
  const normalizedTemplateForm =
    typeof templateForm === "string" ? parseTemplateForm(templateForm) : null;
  const side = serializeProjectSideSurfaceEntry({
    entryMode: "templateDirect",
    kind: "projectCreation",
    ...(normalizedTemplateName == null
      ? {}
      : { templateName: normalizedTemplateName }),
    ...(normalizedTemplateName != null && normalizedTemplateForm != null
      ? { templateForm: JSON.stringify(normalizedTemplateForm) }
      : {}),
  });
  const searchParams = new URLSearchParams();
  if (side != null) {
    searchParams.set("side", side);
  }
  const query = searchParams.toString();
  return query === "" ? "/project" : `/project?${query}`;
}
