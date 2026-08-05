ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "execution_mode" text DEFAULT 'brain' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_contract_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_skill_revision" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_turn_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_repair_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_last_report_digest" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD CONSTRAINT "deploy_tasks_agent_contract_version_nonnegative" CHECK ("sealai_deployment"."deploy_tasks"."agent_contract_version" >= 0);--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD CONSTRAINT "deploy_tasks_agent_turn_count_nonnegative" CHECK ("sealai_deployment"."deploy_tasks"."agent_turn_count" >= 0);--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD CONSTRAINT "deploy_tasks_agent_repair_count_nonnegative" CHECK ("sealai_deployment"."deploy_tasks"."agent_repair_count" >= 0);