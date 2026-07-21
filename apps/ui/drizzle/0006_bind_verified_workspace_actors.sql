ALTER TABLE "sealai_assistant"."github_oauth_connections" ADD COLUMN "workspace_actor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_oauth_connections" ADD COLUMN "owner_identity_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "github_oauth_connections_current_owner_unique_idx" ON "sealai_assistant"."github_oauth_connections" USING btree ("namespace","workspace_actor") WHERE "sealai_assistant"."github_oauth_connections"."owner_identity_version" = 1;--> statement-breakpoint
DELETE FROM "sealai_assistant"."assistant_chats";--> statement-breakpoint
DROP INDEX "sealai_assistant"."assistant_chats_namespace_user_updated_at_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" RENAME COLUMN "user_id" TO "workspace_actor";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" ALTER COLUMN "workspace_actor" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "assistant_chats_namespace_actor_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("namespace","workspace_actor","updated_at");--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "creating_actor" text;--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "credential_binding" jsonb;--> statement-breakpoint
DROP INDEX "sealai_assistant"."github_oauth_connections_namespace_user_unique_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" ALTER COLUMN "user_id" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" ADD COLUMN "workspace_actor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" ADD COLUMN "owner_identity_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DELETE FROM "sealai_assistant"."github_app_install_sessions";--> statement-breakpoint
DELETE FROM "sealai_assistant"."github_oauth_connections";--> statement-breakpoint
DELETE FROM "sealai_assistant"."github_connections";--> statement-breakpoint
DELETE FROM "sealai_assistant"."assistant_chat_messages";--> statement-breakpoint
DELETE FROM "sealai_assistant"."assistant_chats";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_oauth_connections" DROP COLUMN "user_id";
