import { redirect } from "next/navigation";
import { githubDeployProjectPath } from "@/features/deploy/github-deploy-link";
import { templateDeployProjectPath } from "@/features/deploy/template-deploy-link";
import {
  appendMarketingRedirectQuery,
  type MarketingRedirectQuery,
} from "@/features/marketing/redirect-query";

export default async function DeployPage({
  searchParams,
}: {
  searchParams: Promise<MarketingRedirectQuery>;
}) {
  const query = await searchParams;
  const { autoDeploy, githubRepo, templateForm, templateName } = query;
  // Only a single, non-empty repo value may claim the GitHub deep link; an
  // empty or repeated `githubRepo` must not steal a parallel template link.
  if (typeof githubRepo === "string" && githubRepo.trim() !== "") {
    redirect(
      appendMarketingRedirectQuery(
        githubDeployProjectPath(githubRepo, autoDeploy),
        query
      )
    );
  }
  redirect(
    appendMarketingRedirectQuery(
      templateDeployProjectPath(templateName, templateForm),
      query
    )
  );
}
