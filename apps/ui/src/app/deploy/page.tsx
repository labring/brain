import { redirect } from "next/navigation";
import { templateDeployProjectPath } from "@/features/deploy/template-deploy-link";

export default async function DeployPage({
  searchParams,
}: {
  searchParams: Promise<{
    templateForm?: string | string[];
    templateName?: string | string[];
  }>;
}) {
  const { templateForm, templateName } = await searchParams;
  redirect(templateDeployProjectPath(templateName, templateForm));
}
