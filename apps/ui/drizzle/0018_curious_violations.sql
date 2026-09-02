DROP INDEX "sealai_assistant"."assistant_chats_namespace_actor_updated_at_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" ADD COLUMN "project_id" text;--> statement-breakpoint
CREATE INDEX "assistant_chats_namespace_actor_project_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("namespace","workspace_actor","project_id","updated_at");