-- Baseline for app-owned Postgres state. Idempotent (IF NOT EXISTS / guarded
-- FKs) so databases provisioned by the pre-migration mechanisms (`drizzle-kit
-- push` or the removed runtime bootstraps) adopt it as a no-op. Assumes such
-- databases already match the current schema shape; legacy shapes older than
-- that are not upgraded here — reset them instead.
--
-- `sealai_project.ap_image_versions` is intentionally absent: the Go API owns
-- that table (apps/api/service/apversion/store.go).
CREATE SCHEMA IF NOT EXISTS "sealai_assistant";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "sealai_deployment";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "sealai_project";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_assistant"."assistant_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_assistant"."assistant_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"title" text DEFAULT 'Chat' NOT NULL,
	"title_ai_generated" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_assistant"."assistant_entitlements" (
	"namespace" text PRIMARY KEY NOT NULL,
	"free_turns_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_assistant"."github_connections" (
	"namespace" text PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"token_type" text DEFAULT 'bearer' NOT NULL,
	"encrypted_access_token" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_deployment"."deploy_task_events" (
	"task_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"phase" text,
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_task_events_pk" PRIMARY KEY("task_id","seq")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_deployment"."deploy_task_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_deployment"."deploy_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"project_uid" text,
	"project_name" text,
	"prompt" text,
	"source" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"runner" jsonb NOT NULL,
	"created_from" text DEFAULT 'api' NOT NULL,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"runtime_provider" text,
	"runtime_name" text,
	"runtime_state" text,
	"gateway_url" text,
	"gateway_session_id" text,
	"gateway_thread_id" text,
	"gateway_turn_id" text,
	"gateway_state_snapshot" jsonb,
	"failure_details" jsonb,
	"artifact_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canvas_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeline_snapshot" jsonb,
	"blocking_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview_url" text,
	"result_url" text,
	"error" text,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_project"."project_canvas_layouts" (
	"namespace" text NOT NULL,
	"project_uid" text NOT NULL,
	"project_name_snapshot" text,
	"version" integer DEFAULT 0 NOT NULL,
	"nodes" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_canvas_layouts_pk" PRIMARY KEY("namespace","project_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_project"."project_navigation_preferences" (
	"namespace" text NOT NULL,
	"pinned_project_ids" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_navigation_preferences_pk" PRIMARY KEY("namespace")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealai_project"."projects" (
	"namespace" text NOT NULL,
	"id" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_pk" PRIMARY KEY("namespace","id")
);
--> statement-breakpoint
-- Guarded FK adds: pre-migration databases may carry the same FK under a
-- different auto-generated name (inline `references` in the old bootstrap), so
-- guard on "table already has a FK" rather than on the constraint name.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE c.contype = 'f' AND n.nspname = 'sealai_assistant' AND t.relname = 'assistant_chat_messages'
	) THEN
		ALTER TABLE "sealai_assistant"."assistant_chat_messages" ADD CONSTRAINT "assistant_chat_messages_chat_id_assistant_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "sealai_assistant"."assistant_chats"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE c.contype = 'f' AND n.nspname = 'sealai_deployment' AND t.relname = 'deploy_task_events'
	) THEN
		ALTER TABLE "sealai_deployment"."deploy_task_events" ADD CONSTRAINT "deploy_task_events_task_id_deploy_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "sealai_deployment"."deploy_tasks"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE c.contype = 'f' AND n.nspname = 'sealai_deployment' AND t.relname = 'deploy_task_messages'
	) THEN
		ALTER TABLE "sealai_deployment"."deploy_task_messages" ADD CONSTRAINT "deploy_task_messages_task_id_deploy_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "sealai_deployment"."deploy_tasks"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_chat_messages_chat_id_idx" ON "sealai_assistant"."assistant_chat_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_chat_messages_chat_id_created_idx" ON "sealai_assistant"."assistant_chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_chats_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_chats_namespace_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("namespace","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_entitlements_updated_at_idx" ON "sealai_assistant"."assistant_entitlements" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_connections_updated_at_idx" ON "sealai_assistant"."github_connections" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_connections_github_login_idx" ON "sealai_assistant"."github_connections" USING btree ("github_login");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_task_events_task_created_at_idx" ON "sealai_deployment"."deploy_task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_task_messages_task_id_idx" ON "sealai_deployment"."deploy_task_messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_task_messages_task_created_idx" ON "sealai_deployment"."deploy_task_messages" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_tasks_namespace_updated_at_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("namespace","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_tasks_project_uid_updated_at_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("project_uid","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_tasks_status_updated_at_idx" ON "sealai_deployment"."deploy_tasks" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_canvas_layouts_updated_at_idx" ON "sealai_project"."project_canvas_layouts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_navigation_preferences_updated_at_idx" ON "sealai_project"."project_navigation_preferences" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_namespace_display_name_idx" ON "sealai_project"."projects" USING btree ("namespace","display_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_updated_at_idx" ON "sealai_project"."projects" USING btree ("updated_at");
