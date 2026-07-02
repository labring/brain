import type { LogsData } from "@workspace/ui/components/log-viewer/log-viewer.context";

/** Wide live span so demo rows stay inside the window as wall time passes. */
export const LOG_VIEWER_PREVIEW_LIVE_SPAN_MS = 24 * 60 * 60_000;

/** Deterministic mock logs for registry previews (detail panes, log viewer, etc.). */
export function buildMockLogs(now: number): LogsData {
  return [
    {
      time: new Date(now - 4 * 60_000).toISOString(),
      message: "INFO: Server started on port 3000",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000 - 50_000).toISOString(),
      message: "INFO: Loading configuration from /etc/app/config.yaml",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000 - 45_000).toISOString(),
      message:
        "DEBUG: Initializing connection pool (max=20, idle=5, timeout=30s)",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000 - 40_000).toISOString(),
      message: "INFO: Connected to PostgreSQL at db-primary.svc:5432",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000 - 35_000).toISOString(),
      message: "INFO: Redis cache connected at redis-master.svc:6379",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000 - 30_000).toISOString(),
      message:
        "INFO: Registered routes: GET /api/v1/users, POST /api/v1/users, GET /api/v1/health",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000 - 25_000).toISOString(),
      message: "INFO: TLS certificate loaded, expiry: 2026-09-15T00:00:00Z",
      pod: "web-7b9f5d4-abc12",
      container: "sidecar",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 3 * 60_000).toISOString(),
      message: "DEBUG: Connected to database",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 2 * 60_000 - 50_000).toISOString(),
      message: "INFO: Worker process started (pid=42, concurrency=8)",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stdout",
      node: "node-2",
    },
    {
      time: new Date(now - 2 * 60_000 - 40_000).toISOString(),
      message: "INFO: Subscribed to queue: jobs.default, jobs.priority",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stdout",
      node: "node-2",
    },
    {
      time: new Date(now - 2 * 60_000 - 30_000).toISOString(),
      message:
        'DEBUG: Processing job #1230 (type=email.send, payload={"to":"user@example.com"})',
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stdout",
      node: "node-2",
    },
    {
      time: new Date(now - 2 * 60_000 - 20_000).toISOString(),
      message: "INFO: Job #1230 completed in 245ms",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stdout",
      node: "node-2",
    },
    {
      time: new Date(now - 2 * 60_000 - 10_000).toISOString(),
      message: "DEBUG: GET /api/v1/users 200 12ms - request_id=req-a1b2c3d4",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 2 * 60_000).toISOString(),
      message: "WARN: High memory usage detected (85%)",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stderr",
      node: "node-2",
    },
    {
      time: new Date(now - 1 * 60_000 - 50_000).toISOString(),
      message:
        "WARN: Slow query detected (1523ms): SELECT * FROM orders WHERE created_at > $1",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stderr",
      node: "node-1",
    },
    {
      time: new Date(now - 1 * 60_000 - 40_000).toISOString(),
      message:
        "INFO: Autoscaler triggered: scaling worker replicas from 2 to 4",
      pod: "api-gateway-3f2a1b-ghi56",
      container: "gateway",
      stream: "stdout",
      node: "node-3",
    },
    {
      time: new Date(now - 1 * 60_000 - 30_000).toISOString(),
      message:
        "ERROR: Connection refused to upstream service payments.svc:8080 - retrying (attempt 1/3)",
      pod: "api-gateway-3f2a1b-ghi56",
      container: "gateway",
      stream: "stderr",
      node: "node-3",
    },
    {
      time: new Date(now - 1 * 60_000 - 20_000).toISOString(),
      message:
        "ERROR: Connection refused to upstream service payments.svc:8080 - retrying (attempt 2/3)",
      pod: "api-gateway-3f2a1b-ghi56",
      container: "gateway",
      stream: "stderr",
      node: "node-3",
    },
    {
      time: new Date(now - 1 * 60_000 - 10_000).toISOString(),
      message:
        "INFO: Upstream service payments.svc:8080 recovered after 2 retries",
      pod: "api-gateway-3f2a1b-ghi56",
      container: "gateway",
      stream: "stdout",
      node: "node-3",
    },
    {
      time: new Date(now - 1 * 60_000).toISOString(),
      message:
        "ERROR: Failed to process job #1234 - TypeError: Cannot read properties of undefined (reading 'email')",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stderr",
      node: "node-2",
    },
    {
      time: new Date(now - 55_000).toISOString(),
      message:
        "WARN: Rate limit approaching for client api-key-xxxx (950/1000 requests)",
      pod: "api-gateway-3f2a1b-ghi56",
      container: "gateway",
      stream: "stderr",
      node: "node-3",
    },
    {
      time: new Date(now - 50_000).toISOString(),
      message:
        "DEBUG: Cache miss for key user:profile:5678, fetching from database",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 45_000).toISOString(),
      message:
        "INFO: Cron job scheduled: cleanup-temp-files (next: */5 * * * *)",
      pod: "scheduler-9d4b2e-jkl78",
      container: "scheduler",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 40_000).toISOString(),
      message: "INFO: Removed 342 expired session records",
      pod: "scheduler-9d4b2e-jkl78",
      container: "scheduler",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 35_000).toISOString(),
      message: "DEBUG: POST /api/v1/users 201 89ms - request_id=req-e5f6g7h8",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 30_000).toISOString(),
      message: "INFO: Health check passed",
      pod: "web-7b9f5d4-abc12",
      container: "sidecar",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 25_000).toISOString(),
      message: "WARN: Disk usage at 78% on /var/log — consider rotating logs",
      pod: "scheduler-9d4b2e-jkl78",
      container: "scheduler",
      stream: "stderr",
      node: "node-1",
    },
    {
      time: new Date(now - 20_000).toISOString(),
      message:
        "ERROR: Unhandled promise rejection: MongoNetworkError: connection timed out (address: mongo-0.svc:27017)",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stderr",
      node: "node-2",
    },
    {
      time: new Date(now - 15_000).toISOString(),
      message: "INFO: Reconnected to MongoDB replica set (mongo-0.svc:27017)",
      pod: "worker-6c8e3a1-def34",
      container: "worker",
      stream: "stdout",
      node: "node-2",
    },
    {
      time: new Date(now - 10_000).toISOString(),
      message:
        "INFO: Deployment rollout complete: web-7b9f5d4 (3/3 replicas ready)",
      pod: "api-gateway-3f2a1b-ghi56",
      container: "gateway",
      stream: "stdout",
      node: "node-3",
    },
    {
      time: new Date(now - 5000).toISOString(),
      message: "DEBUG: WebSocket connections active: 127, peak: 203",
      pod: "web-7b9f5d4-abc12",
      container: "app",
      stream: "stdout",
      node: "node-1",
    },
    {
      time: new Date(now - 2000).toISOString(),
      message:
        "INFO: Metrics exported to Prometheus (endpoint=/metrics, scrape_duration=8ms)",
      pod: "web-7b9f5d4-abc12",
      container: "sidecar",
      stream: "stdout",
      node: "node-1",
    },
  ];
}
