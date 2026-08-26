ALTER TABLE "sealai_assistant"."assistant_devbox_runtimes" ADD COLUMN "workspace_actor" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_devbox_runtimes_workspace_actor_idx" ON "sealai_assistant"."assistant_devbox_runtimes" USING btree ("workspace_actor");
