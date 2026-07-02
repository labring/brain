CREATE TABLE IF NOT EXISTS "sealai_assistant"."github_app_install_sessions" (
	"state" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"return_path" text,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE IF EXISTS "sealai_assistant"."github_connections" CASCADE;
--> statement-breakpoint
CREATE TABLE "sealai_assistant"."github_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"type" text DEFAULT 'github_app' NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text DEFAULT 'User' NOT NULL,
	"repository_selection" text DEFAULT 'all' NOT NULL,
	"installed_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN IF NOT EXISTS "actor_user_id" text;
--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN IF NOT EXISTS "github_connection_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_app_install_sessions_expires_at_idx" ON "sealai_assistant"."github_app_install_sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_app_install_sessions_namespace_idx" ON "sealai_assistant"."github_app_install_sessions" USING btree ("namespace");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_connections_updated_at_idx" ON "sealai_assistant"."github_connections" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_connections_namespace_updated_at_idx" ON "sealai_assistant"."github_connections" USING btree ("namespace","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_connections_namespace_unique_idx" ON "sealai_assistant"."github_connections" USING btree ("namespace");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_connections_installation_idx" ON "sealai_assistant"."github_connections" USING btree ("installation_id");
