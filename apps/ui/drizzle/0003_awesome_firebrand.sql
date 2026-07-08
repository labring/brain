CREATE TABLE "sealai_assistant"."github_oauth_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"user_id" text NOT NULL,
	"github_login" text NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"token_type" text DEFAULT 'bearer' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"last_used_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_oauth_connections_updated_at_idx" ON "sealai_assistant"."github_oauth_connections" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "github_oauth_connections_github_login_idx" ON "sealai_assistant"."github_oauth_connections" USING btree ("github_login");--> statement-breakpoint
CREATE UNIQUE INDEX "github_oauth_connections_namespace_user_unique_idx" ON "sealai_assistant"."github_oauth_connections" USING btree ("namespace","user_id");