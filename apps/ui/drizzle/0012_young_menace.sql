CREATE TABLE "sealai_assistant"."assistant_devbox_runtimes" (
	"upstream_id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"runtime_name" text NOT NULL,
	"pause_due_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"delete_due_at" timestamp with time zone,
	"cleanup_lease_owner" text,
	"cleanup_lease_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "runtime_paused_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sealai_deployment"."deploy_tasks"
SET "runtime_paused_at" = coalesce("updated_at", "completed_at", "created_at")
WHERE "runtime_provider" = 'devbox'
	AND lower(coalesce("runtime_state", '')) IN ('paused', 'archived')
	AND "runtime_paused_at" IS NULL;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "runtime_cleanup_lease_owner" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "runtime_cleanup_lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "assistant_devbox_runtimes_pause_due_idx" ON "sealai_assistant"."assistant_devbox_runtimes" USING btree ("pause_due_at") WHERE "sealai_assistant"."assistant_devbox_runtimes"."paused_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assistant_devbox_runtimes_delete_due_idx" ON "sealai_assistant"."assistant_devbox_runtimes" USING btree ("delete_due_at") WHERE "sealai_assistant"."assistant_devbox_runtimes"."delete_due_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deploy_tasks_runtime_paused_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("runtime_paused_at") WHERE "sealai_deployment"."deploy_tasks"."runtime_provider" = 'devbox' AND lower(coalesce("sealai_deployment"."deploy_tasks"."runtime_state", '')) IN ('paused', 'archived');
