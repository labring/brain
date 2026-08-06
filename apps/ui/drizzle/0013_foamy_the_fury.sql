CREATE TABLE "sealai_deployment"."deploy_task_agent_calls" (
	"task_id" text NOT NULL,
	"call_id" text NOT NULL,
	"lease_epoch" bigint NOT NULL,
	"tool_name" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"response" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "deploy_task_agent_calls_pk" PRIMARY KEY("task_id","call_id")
);
--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_protocol" text DEFAULT 'file-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_run_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_control_token_hash" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_control_token_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_template_digest" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_input_schema_digest" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_checkpoint_id" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_input_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "agent_completion_receipt" jsonb;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_task_agent_calls" ADD CONSTRAINT "deploy_task_agent_calls_task_id_deploy_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "sealai_deployment"."deploy_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deploy_task_agent_calls_pending_idx" ON "sealai_deployment"."deploy_task_agent_calls" USING btree ("task_id","created_at") WHERE "sealai_deployment"."deploy_task_agent_calls"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_tasks_agent_control_token_hash_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("agent_control_token_hash") WHERE "sealai_deployment"."deploy_tasks"."agent_control_token_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD CONSTRAINT "deploy_tasks_agent_run_epoch_nonnegative" CHECK ("sealai_deployment"."deploy_tasks"."agent_run_epoch" >= 0);--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD CONSTRAINT "deploy_tasks_agent_input_revision_nonnegative" CHECK ("sealai_deployment"."deploy_tasks"."agent_input_revision" >= 0);