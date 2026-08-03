CREATE TABLE "sealai_project"."project_delete_operations" (
	"namespace" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_uid" text NOT NULL,
	"preview_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_delete_operations_pk" PRIMARY KEY("namespace","project_id")
);
--> statement-breakpoint
CREATE TABLE "sealai_project"."project_delete_previews" (
	"id" text NOT NULL,
	"actor_uid" text NOT NULL,
	"chat_id" text NOT NULL,
	"namespace" text NOT NULL,
	"project_id" text NOT NULL,
	"display_name" text NOT NULL,
	"resource_summary" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_delete_previews_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "sealai_project"."project_management_audit_events" (
	"id" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"actor_uid" text NOT NULL,
	"chat_id" text NOT NULL,
	"namespace" text NOT NULL,
	"project_id" text NOT NULL,
	"display_name" text NOT NULL,
	"resource_summary" jsonb NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_management_audit_events_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE INDEX "project_delete_operations_expires_at_idx" ON "sealai_project"."project_delete_operations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "project_delete_previews_expires_at_idx" ON "sealai_project"."project_delete_previews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "project_delete_previews_target_idx" ON "sealai_project"."project_delete_previews" USING btree ("namespace","project_id");--> statement-breakpoint
CREATE INDEX "project_management_audit_events_target_idx" ON "sealai_project"."project_management_audit_events" USING btree ("namespace","project_id","created_at");