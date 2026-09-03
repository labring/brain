DROP INDEX "sealai_assistant"."assistant_chats_namespace_actor_updated_at_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" ADD COLUMN "scope_kind" text;--> statement-breakpoint
UPDATE "sealai_assistant"."assistant_chats"
SET "scope_kind" = 'project'
WHERE "scope_kind" IS NULL
  AND "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_chats_namespace_actor_scope_project_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("namespace","workspace_actor","scope_kind","project_id","updated_at");
