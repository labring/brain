# AP Docker Image Agent-Friendly Lifecycle Test Cases

Status: ready for agent execution

## 0. Scope

This suite focuses only on AP resources created from Docker images. It covers the full create-and-manage lifecycle for an AP workload, including Docker image input, app listening port, command, args, environment variables, config files, PVC-backed storage, public access, settings changes, lifecycle operations, observability surfaces, canvas persistence, and cleanup.

Out of scope:

- DB deployment and DB lifecycle.
- Template deployment and template-produced workloads.
- GitHub deployment and AI runner behavior.
- AP-to-DB binding.
- Raw Kubernetes-only validation that has no product UI or API evidence.

## 1. Product Contract Under Test

Docker image deployment creates a Deployment Task with:

- `source.kind = docker`
- `runner.kind = direct`
- an AP product resource as the main result
- Project Canvas projection while deployment is running
- an AP/workload node after resource discovery

Docker deployment settings currently support:

- Docker image string.
- App Listening Port from `1` to `65535`, default `80`.
- Optional command, one argument per line.
- Optional args, one argument per line.
- Direct environment variables.
- Config file mounts with absolute paths.
- Storage mounts with absolute paths and size suffix `Mi`, `Gi`, or `Ti`.

Validation rules to verify:

- Docker image is required and must not contain spaces.
- Environment variable names are required, unique, and must not start with a digit.
- Config file mount paths must be absolute and unique.
- Storage mount paths must be absolute and unique.
- Storage size must look like `512Mi`, `1Gi`, `10Gi`, or `1Ti`.

## 2. Agent Execution Contract

Use unique names for each run:

- Project prefix: `agent-ap-docker-<timestamp>`
- Primary AP project: `agent-ap-docker-main-<timestamp>`
- Delete-only AP project: `agent-ap-docker-delete-<timestamp>`
- Invalid-input checks should not create resources.

Evidence to capture for each executed case:

- Visible UI state or screenshot.
- Relevant Network request path, method, status, and request body summary.
- Deployment Task id when a task is created.
- Project id/name and namespace.
- AP name/display name.
- Final pass/fail/block verdict.

Do not delete the primary AP until all dependent tests finish. Use the delete-only AP for destructive cleanup behavior.

## 3. Preflight

### TC-AP-DOC-00 Open Brain And Confirm Environment

Goal: Confirm the test environment can load Brain and has credentials for creating AP resources.

Steps:

1. Open Brain UI.
2. Confirm the project explorer, project canvas, or project creation entry is visible.
3. Confirm the current namespace is known.
4. Open browser Network panel or equivalent request capture.
5. Confirm there are no persistent `401`, `403`, missing kubeconfig, or Go API `502` errors.

Expected:

- Brain UI is usable.
- Product API requests carry the expected auth/kubeconfig context.
- The environment is suitable for creating and deleting AP resources.

Failure handling:

- If API returns `502`, start or verify the Go API before continuing.
- If auth/kubeconfig is missing, stop and report preflight blocked.

## 4. Creation And Deployment Task

### TC-AP-DOC-01 Create Minimal AP From Docker Image

Goal: Create a basic AP from Docker image and verify the deployment task, project, and canvas node.

Input:

- Docker image: `nginx:1.27-alpine`
- App Listening Port: `80`
- Project name: `agent-ap-docker-main-<timestamp>`

Steps:

1. Open the project creation entry.
2. Select `Docker image` or equivalent AP Docker deployment entry.
3. Fill Docker image with `nginx:1.27-alpine`.
4. Fill App Listening Port with `80`.
5. Fill project name with `agent-ap-docker-main-<timestamp>` if shown.
6. Click `Deploy`.
7. Wait for task-created toast or visible deployment progress.
8. Capture the `/api/deploy-tasks` request body.
9. Enter the created project canvas.
10. Wait for a deployment placeholder or AP/workload node.
11. Open the Deployment Task Timeline from the dock or task affordance.

Expected:

- `/api/deploy-tasks` returns success.
- Request body contains `source.kind = docker`.
- Request body contains `runner.kind = direct`.
- A project is created or selected as target.
- Deployment Task Timeline shows queued/running/apply/verify/completed or an equivalent direct-runner flow.
- Canvas shows an AP/workload node after resource discovery.

Evidence:

- Task id.
- Project id/name.
- AP display name.
- Network request body summary.
- Screenshot of canvas or timeline.

Cleanup:

- Keep this AP for later tests.

### TC-AP-DOC-02 Create AP With Command Args Env Config And PVC

Goal: Create an AP that exercises all Docker deployment settings in one valid deployment.

Input:

- Docker image: `nginx:1.27-alpine`
- App Listening Port: `80`
- Command:
  - `nginx`
- Args:
  - `-g`
  - `daemon off;`
- Environment variables:
  - `APP_ENV=agent`
  - `FEATURE_FLAG=true`
  - `NESTED.VALUE=allowed`
  - `DASH_VALUE=allowed`
- Config file:
  - Path: `/etc/nginx/conf.d/agent.conf`
  - Value:

```nginx
server {
  listen 80;
  location / {
    return 200 "agent-ap-docker";
  }
}
```

- Storage mount:
  - Path: `/data`
  - Size: `1Gi`

Steps:

1. Open the Docker image deployment entry.
2. Fill image and port.
3. Fill command with one line: `nginx`.
4. Fill args as two lines: `-g` and `daemon off;`.
5. Add the four environment variables listed above.
6. Add the config file path and value.
7. Add storage mount `/data` with size `1Gi`.
8. Click `Deploy`.
9. Capture the `/api/deploy-tasks` request body.
10. Open the created project canvas.
11. Wait for the AP/workload node.
12. Open AP settings or resource details.

Expected:

- Deploy button is enabled before submit.
- Request body includes Docker settings for image, port, command, args, env, configMaps, and storage.
- Storage presence results in a persistent workload shape; current renderer uses a stateful workload when storage exists.
- AP node appears on canvas.
- AP details/settings expose workload configuration or enough evidence to confirm deployment settings were accepted.

Evidence:

- Request body summary for `source.docker`.
- AP node screenshot.
- Settings/details screenshot showing configured values if visible.

Cleanup:

- Delete this AP project after its evidence is captured, unless it is used for further storage tests.

## 5. Validation Cases

### TC-AP-DOC-03 Reject Missing Or Invalid Docker Image

Goal: Verify image validation blocks invalid AP creation before a task is created.

Steps:

1. Open Docker image deployment entry.
2. Leave Docker image empty.
3. Try to deploy.
4. Fill Docker image with `nginx invalid`.
5. Try to deploy again.

Expected:

- Empty image shows an error equivalent to `Docker image is required.`
- Image with spaces shows an error equivalent to `Docker image must not contain spaces.`
- Deploy button remains disabled or submit is blocked.
- No `/api/deploy-tasks` request is sent.

Evidence:

- Screenshot of validation error.
- Network evidence showing no task creation request.

### TC-AP-DOC-04 Reject Invalid App Listening Port

Goal: Verify port validation blocks invalid AP creation.

Steps:

1. Fill Docker image with `nginx:1.27-alpine`.
2. Try App Listening Port values: `0`, `65536`, `abc`, and empty value.
3. Observe validation state for each value.
4. Fill App Listening Port with `80`.

Expected:

- Invalid values show an error equivalent to `App Listening Port must be a TCP port from 1 to 65535.`
- Deploy is blocked while invalid.
- Valid port `80` clears the port error.

Evidence:

- Screenshot or notes for invalid and valid states.

### TC-AP-DOC-05 Reject Invalid Environment Variables

Goal: Verify environment variable validation for missing, invalid, and duplicate names.

Steps:

1. Fill Docker image with `nginx:1.27-alpine`.
2. Add an environment variable row with empty name and value `x`.
3. Observe validation.
4. Change name to `1INVALID`.
5. Observe validation.
6. Change name to `VALID_NAME`.
7. Add another row with name `VALID_NAME`.
8. Observe duplicate-name validation.

Expected:

- Empty name is rejected.
- Name starting with digit is rejected.
- Duplicate names are rejected.
- Valid unique names using letters, digits, underscores, dots, or hyphens are accepted.
- No Deployment Task is created while invalid.

Evidence:

- Validation screenshot.
- Network evidence showing no task creation request.

### TC-AP-DOC-06 Reject Invalid Config File Mounts

Goal: Verify config file path validation.

Steps:

1. Fill Docker image with `nginx:1.27-alpine`.
2. Add config file path `relative.conf`.
3. Observe validation.
4. Change path to `/etc/app/config.yaml`.
5. Add another config file with the same path.
6. Observe duplicate mount path validation.

Expected:

- Relative path is rejected.
- Duplicate absolute paths are rejected.
- Unique absolute paths are accepted.

Evidence:

- Validation screenshot.

### TC-AP-DOC-07 Reject Invalid Storage Mounts

Goal: Verify PVC/storage path and size validation.

Steps:

1. Fill Docker image with `nginx:1.27-alpine`.
2. Add storage path `data` with size `1Gi`.
3. Observe invalid path validation.
4. Change path to `/data` and size to `1GB`.
5. Observe invalid size validation.
6. Change size to `512Mi`.
7. Add another storage mount with path `/data` and size `1Gi`.
8. Observe duplicate path validation.

Expected:

- Relative storage path is rejected.
- Size without `Mi`, `Gi`, or `Ti` suffix is rejected.
- Duplicate storage paths are rejected.
- Valid `/data` with `512Mi` is accepted.

Evidence:

- Validation screenshot.

## 6. Runtime Configuration Management

### TC-AP-DOC-08 Edit AP Environment Variables After Creation

Goal: Verify AP environment settings can be edited after Docker deployment.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open the AP node.
2. Open AP Settings.
3. Open Environment section.
4. Add or change an environment variable:
   - `RUNTIME_EDIT=updated`
5. Save changes.
6. Wait for success toast or resource refresh.
7. Reopen settings or inspect details.

Expected:

- Save is blocked if env validation is invalid.
- Save succeeds with valid env variable.
- AP resource refreshes after save.
- Updated env value is visible in settings or reflected in the backing API request.

Evidence:

- PATCH request path/status.
- Request body summary.
- Settings screenshot after save.

### TC-AP-DOC-09 Edit Launch Command And Args After Creation

Goal: Verify command and args can be managed either at creation time or through AP settings when supported.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP Settings or workload configuration surface.
2. Locate command/args controls if exposed.
3. If exposed, change command/args to a safe nginx equivalent.
4. Save.
5. Wait for resource refresh.
6. If not exposed after creation, record that command/args are creation-time only in current UI.

Expected:

- If command/args are editable, save sends a valid AP update and resource refreshes.
- If command/args are not editable, creation-time command/args coverage remains in `TC-AP-DOC-02`.

Evidence:

- Screenshot of controls or absence.
- API request summary if edited.

### TC-AP-DOC-10 Edit Resource Capacity Or Replica Strategy

Goal: Verify AP compute or replica settings can be viewed and updated.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP Settings.
2. Locate resource capacity or replica strategy section.
3. Change one safe setting, such as replicas from `1` to `1` through the UI if only confirmation is needed, or to `2` if the test environment has capacity.
4. Save.
5. Wait for resource refresh.
6. Restore the original setting if it changed runtime capacity.

Expected:

- Settings draft detects changes.
- Save sends a valid AP update.
- AP remains visible and eventually returns to running/ready state.
- Restoring original setting succeeds if a real change was made.

Evidence:

- Request path/status.
- Before/after setting values.

Failure handling:

- If the environment does not have enough capacity for replica increase, keep the test at no-op confirmation or skip with reason.

## 7. Network And Public Access

### TC-AP-DOC-11 Verify Private Address And App Listening Port

Goal: Verify the AP exposes the configured app listening port as a private address.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP node details.
2. Locate Network, Private Address, or App Listening Ports.
3. Confirm port `80` is shown.
4. Copy or record the private address if shown.

Expected:

- The configured app listening port appears as `80`.
- Private address is shown once the AP exists.
- Private address is not treated as pending after the app listening port exists.

Evidence:

- Network/settings screenshot.

### TC-AP-DOC-12 Toggle Platform Public Access

Goal: Verify public access can be enabled and disabled for the AP.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP Settings.
2. Open Network section.
3. Enable platform public access for port `80`.
4. Save.
5. Wait for resource refresh.
6. Record the generated public address or routing state.
7. Confirm AP Public Access node or public access presentation appears on canvas if supported.
8. Disable public access.
9. Save and wait for refresh.

Expected:

- Enabling public access creates or updates AP-owned public routing intent.
- A platform public address or public routing state is visible.
- Disabling public access removes or disables the public address view.
- AP Public Access is presentation-only and should not behave as an independent settings owner.

Evidence:

- Request body summary.
- Before/after network screenshots.
- Canvas screenshot if public access node appears.

Failure handling:

- If the cluster cannot allocate public access, record routing state and blocked reason instead of failing the whole AP suite.

### TC-AP-DOC-13 Add And Remove An Extra App Listening Port

Goal: Verify AP network settings can add or remove an app listening port when the UI supports it.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP Network Settings.
2. Check whether adding an app listening port is exposed.
3. If exposed, add port `8080`.
4. Save and wait for refresh.
5. Confirm private address for port `8080` appears.
6. Remove port `8080`.
7. Save and wait for refresh.
8. Confirm port `80` remains.

Expected:

- Extra port can be added and removed without deleting the AP.
- Removing extra port does not delete the primary app listening port.
- If UI does not expose this operation, record it as not currently supported by the product surface.

Evidence:

- Before/after network screenshots.
- Request path/status if changed.

## 8. Lifecycle Operations

### TC-AP-DOC-14 Pause And Start AP

Goal: Verify AP pause/start lifecycle through the product UI.

Preconditions:

- `TC-AP-DOC-01` primary AP exists and is operational enough for lifecycle actions.

Steps:

1. Open AP node action menu or resource panel actions.
2. Click Stop/Pause/Suspend.
3. Wait for toast or resource update.
4. Confirm AP state becomes paused, stopped, inactive, or replicas become `0`.
5. Click Start/Resume.
6. Wait for resource update.
7. Confirm AP returns to running/active/ready or expected desired state.

Expected:

- Pause sends AP update equivalent to `paused: true`.
- Start sends AP update equivalent to `paused: false`.
- Canvas/resource state refreshes without manual page reload.

Evidence:

- Network request path/status.
- Before/after AP state screenshots.

### TC-AP-DOC-15 Restart AP

Goal: Verify AP restart action succeeds and produces visible feedback.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP node action menu or resource panel actions.
2. Click Restart.
3. Wait for success toast or event update.
4. Open events/history if available.

Expected:

- Restart sends a request equivalent to AP restart API.
- UI shows success or progress feedback.
- AP remains visible after restart.

Evidence:

- `POST` restart request path/status.
- Toast or event screenshot.

### TC-AP-DOC-16 Delete AP With Confirmation

Goal: Verify AP deletion requires explicit confirmation and cleans canvas state.

Preconditions:

- Create or use a delete-only AP project named `agent-ap-docker-delete-<timestamp>`.

Steps:

1. Open the delete-only AP node.
2. Click Delete action.
3. Confirm the dialog title indicates workload/AP deletion.
4. Verify Delete button is disabled before entering the required display name.
5. Enter an incorrect display name.
6. Verify Delete remains disabled or blocked.
7. Enter the exact display name.
8. Click Delete.
9. Wait for success toast and resource refresh.
10. Confirm AP node disappears from canvas.

Expected:

- Destructive confirmation requires exact display name.
- Delete sends AP delete request.
- AP node disappears.
- Any AP Public Access presentation disappears with the AP.

Evidence:

- Dialog screenshot.
- Delete request path/status.
- Canvas after deletion.

## 9. Observability Surfaces

### TC-AP-DOC-17 Open AP Logs

Goal: Verify AP logs surface opens and handles data, empty, and error states.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP node.
2. Open Logs surface.
3. Wait for log request to finish.
4. Record visible state.

Expected:

- Logs surface opens from AP context.
- Request uses the selected AP identity and namespace.
- UI shows log rows, empty state, or clear error state.

Evidence:

- Logs request path/status.
- Logs pane screenshot.

### TC-AP-DOC-18 Open AP Events Or History

Goal: Verify AP events/history surface is accessible from AP context.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP node.
2. Open Events or History surface.
3. Wait for data load.
4. Record visible state.

Expected:

- Events/history surface opens.
- UI shows recent lifecycle or workload information, or a clear empty state.

Evidence:

- Request path/status.
- Pane screenshot.

### TC-AP-DOC-19 Open AP Metrics

Goal: Verify AP metrics surface is accessible and scoped to the selected workload.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP node.
2. Open Metrics surface.
3. Wait for metrics request.
4. Record visible state.

Expected:

- Metrics surface opens.
- Request is scoped to AP identity and namespace.
- UI shows metric chart/data, empty state, or clear error state.

Evidence:

- Metrics request path/status.
- Metrics pane screenshot.

### TC-AP-DOC-20 Open AP Terminal When Available

Goal: Verify AP terminal entry works or clearly explains why it is unavailable.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Open AP node.
2. Open Terminal surface if available.
3. Wait for terminal URL/session request.
4. If terminal opens, run a harmless command such as `pwd`.
5. If terminal is unavailable, record the visible unavailable state.

Expected:

- Terminal opens for supported running workloads.
- Terminal request is scoped to the AP identity and namespace.
- If unavailable, UI gives a clear disabled/error state.

Evidence:

- Terminal request path/status.
- Terminal screenshot or unavailable-state screenshot.

## 10. Canvas And Persistence

### TC-AP-DOC-21 Canvas Position Survives Refresh

Goal: Verify AP canvas placement persists across refresh.

Preconditions:

- `TC-AP-DOC-01` primary AP exists and AP node is visible.

Steps:

1. Drag AP node to a clearly different canvas position.
2. Wait for layout save or patch request.
3. Refresh the browser page.
4. Reopen the project canvas.
5. Confirm AP node remains at the moved position.

Expected:

- Canvas layout PATCH succeeds.
- AP placement survives refresh.
- Deployment projection or resource refresh does not overwrite user placement.

Evidence:

- Before/after screenshots.
- Layout request path/status.

### TC-AP-DOC-22 Project Reentry Shows AP State

Goal: Verify leaving and re-entering the project restores AP resource state.

Preconditions:

- `TC-AP-DOC-01` primary AP exists.

Steps:

1. Navigate back to project explorer.
2. Open another project or neutral route.
3. Reopen `agent-ap-docker-main-<timestamp>`.
4. Confirm AP node appears.
5. Open AP details.

Expected:

- Project explorer shows the test project.
- Re-entering project restores AP node and resource details.
- No stale deployment placeholder remains when AP resource is already visible.

Evidence:

- Project explorer screenshot.
- Canvas screenshot after reentry.

## 11. Cleanup

### TC-AP-DOC-23 Delete Primary AP Test Project

Goal: Clean up all AP Docker lifecycle test resources.

Preconditions:

- All non-cleanup AP Docker lifecycle tests are complete.

Steps:

1. Return to project explorer.
2. Locate all projects whose names start with `agent-ap-docker-`.
3. Delete each test project through the product UI.
4. Enter exact project display name when prompted.
5. Refresh project explorer.
6. Search or scan for `agent-ap-docker-`.

Expected:

- Every AP Docker lifecycle test project is deleted.
- No AP node from this suite remains visible.
- No test project with prefix `agent-ap-docker-` remains in explorer.

Evidence:

- Deleted project names.
- Final project explorer screenshot.

Failure handling:

- If product UI cleanup fails, record project id/name/namespace and stop. Do not run raw destructive cluster commands unless explicitly approved.

## 12. Reporting Template

Use this report structure after execution:

```markdown
# AP Docker Image Lifecycle Test Report

Date:
Brain URL:
Namespace:
Agent:

## Summary

- Total cases:
- Passed:
- Failed:
- Blocked:
- Not run:

## Test Projects

| Project | Purpose | Final cleanup state |
| --- | --- | --- |
| agent-ap-docker-main-... | primary AP lifecycle | deleted / retained / failed cleanup |
| agent-ap-docker-delete-... | delete confirmation | deleted / retained / failed cleanup |

## Executed Matrix

| Case | Result | Evidence | Notes |
| --- | --- | --- | --- |
| TC-AP-DOC-00 | pass/fail/blocked/not-run | ... | ... |

## Key Network Evidence

- Deployment task creation:
- AP update:
- AP restart:
- AP delete:
- Layout patch:
- Logs:
- Metrics:
- Terminal:

## Issues

1. ...

## Final Verdict

...
```
