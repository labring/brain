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
  // Only a single, non-empty repo value may claim the GitHub deep link; an
  // empty or repeated `githubRepo` must not steal a parallel template link.
  if (typeof githubRepo === "string" && githubRepo.trim() !== "") {
    redirect(githubDeployProjectPath(githubRepo, autoDeploy));
  }
  redirect(templateDeployProjectPath(templateName, templateForm));
}
