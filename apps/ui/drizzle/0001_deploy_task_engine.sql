CREATE SEQUENCE "sealai_deployment"."deploy_task_events_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_task_events" ALTER COLUMN "seq" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_task_events" ALTER COLUMN "seq" SET DEFAULT nextval('sealai_deployment.deploy_task_events_seq'::regclass);--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "lease_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "lease_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "retried_from_task_id" text;--> statement-breakpoint
CREATE INDEX "deploy_tasks_leased_expiry_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("lease_expires_at") WHERE "sealai_deployment"."deploy_tasks"."status" IN ('running', 'applying');--> statement-breakpoint
CREATE INDEX "deploy_tasks_queued_created_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("created_at") WHERE "sealai_deployment"."deploy_tasks"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "deploy_tasks_terminal_completed_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("completed_at") WHERE "sealai_deployment"."deploy_tasks"."status" IN ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_tasks_one_active_clone_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("retried_from_task_id") WHERE "sealai_deployment"."deploy_tasks"."retried_from_task_id" IS NOT NULL AND "sealai_deployment"."deploy_tasks"."status" IN ('queued', 'running', 'blocked', 'applying');