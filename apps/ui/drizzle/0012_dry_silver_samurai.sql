ALTER TABLE "sealai_deployment"."deploy_tasks" DROP CONSTRAINT IF EXISTS "deploy_tasks_agent_contract_version_nonnegative";--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" DROP COLUMN IF EXISTS "execution_mode";--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" DROP COLUMN IF EXISTS "agent_contract_version";--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" DROP COLUMN IF EXISTS "agent_skill_revision";
