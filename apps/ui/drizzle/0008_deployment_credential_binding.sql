ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "creating_actor" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "credential_binding" jsonb;
