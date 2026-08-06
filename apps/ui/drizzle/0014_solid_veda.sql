ALTER TABLE "sealai_deployment"."deploy_task_agent_calls" ADD COLUMN "claim_owner" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_task_agent_calls" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_task_agent_calls" ADD COLUMN "attempt" bigint DEFAULT 0 NOT NULL;