DROP INDEX "sealai_assistant"."github_oauth_connections_namespace_user_unique_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" ALTER COLUMN "user_id" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" ADD COLUMN "workspace_actor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" ADD COLUMN "owner_identity_version" integer DEFAULT 0 NOT NULL;