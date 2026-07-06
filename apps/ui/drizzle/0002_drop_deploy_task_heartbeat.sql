ALTER TABLE "sealai_deployment"."deploy_tasks" DROP COLUMN "heartbeat_at";--> statement-breakpoint
SELECT setval('sealai_deployment.deploy_task_events_seq', COALESCE((SELECT MAX("seq") FROM "sealai_deployment"."deploy_task_events"), 0) + 1, false);--> statement-breakpoint
UPDATE "sealai_deployment"."deploy_tasks"
SET "status" = 'failed',
    "error" = 'Deployment was interrupted before the execution engine rollout.',
    "failure_details" = jsonb_build_object('reason', 'interrupted', 'detail', 'engine-rollout'),
    "completed_at" = now(),
    "updated_at" = now()
WHERE "status" IN ('queued', 'running', 'applying');
