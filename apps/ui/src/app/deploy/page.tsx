import { redirect } from "next/navigation";
import { githubDeployProjectPath } from "@/features/deploy/github-deploy-link";
import { templateDeployProjectPath } from "@/features/deploy/template-deploy-link";

export default async function DeployPage({
  searchParams,
}: {
  searchParams: Promise<{
    autoDeploy?: string | string[];
    githubRepo?: string | string[];
    templateForm?: string | string[];
    templateName?: string | string[];
  }>;
}) {
  const { autoDeploy, githubRepo, templateForm, templateName } =
    await searchParams;
  if (githubRepo !== undefined) {
    redirect(githubDeployProjectPath(githubRepo, autoDeploy));
  }
  redirect(templateDeployProjectPath(templateName, templateForm));
}
