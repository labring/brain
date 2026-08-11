CREATE SCHEMA "sealai_onboarding";
--> statement-breakpoint
CREATE TABLE "sealai_onboarding"."onboarding_profiles" (
	"user_uid" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"dismissed_at_step" integer,
	"role_type" text,
	"role_other_text" text,
	"usage_context" text,
	"usage_other_text" text,
	"priority_tags" jsonb,
	"priority_display_order" jsonb,
	"priority_other_text" text,
	"open_goal_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
