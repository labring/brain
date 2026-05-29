# DB Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "database console" to the DB canvas node — an interactive native engine client (`psql`/`mysql`/`mongosh`/`redis-cli`) that runs in the DB's KubeBlocks primary pod, reusing the AP terminal's exec transport and a shared xterm.js terminal pane.

**Architecture:** The existing `/api/k8s/v1alpha1/exec` WebSocket gains a `kind` discriminator. For `kind:"db"` the server resolves the engine from the DB resource, resolves the KubeBlocks `InstanceSet` leader pod, reads the connection secret, and builds a per-engine client command — all server-side, so credentials never reach the browser (ADR-0013). The frontend extracts a shared `ExecTerminalPane` (xterm.js) from `WorkloadTerminalPane`; AP and DB are thin adapters differing only by `kind` + labels.

**Tech Stack:** Go (client-go dynamic + remotecommand), Next.js/React, `@xterm/xterm` + `@xterm/addon-fit`, jotai, nuqs, gorilla/websocket.

**Reference prior art:** sealos `frontend/providers/dbprovider` — `src/constants/db.ts` (`DBExecInfoMap`), `src/pages/api/resolveDBConnectTarget.ts` (`InstanceSet` leader), `src/utils/database.ts` (`selectConnectPodFromMembersStatus`).

---

## File Structure

**Backend (Go)**
- Create: `apps/api/service/db/console.go` — engine→command map, leader-pod selection, `ResolveConsoleExecTarget`.
- Create: `apps/api/service/db/console_test.go` — table tests for the two pure functions.
- Modify: `apps/api/service/db/access_health_store.go` — add `GetInstanceSetMembers` to the Kubernetes store.
- Modify: `apps/api/service/k8s/exec.go:115` — `StreamPodExec` accepts an optional terminal-size channel.
- Modify: `apps/api/route/k8s/exec_ws.go` — `kind` + `resize` in the protocol; branch to DB console resolution; pass size channel.

**Frontend (TS/React)**
- Modify: `apps/ui/package.json` — add `@xterm/xterm`, `@xterm/addon-fit`.
- Create: `apps/ui/src/lib/project-canvas/panels/exec-terminal-pane.tsx` — shared xterm pane + descriptor type.
- Rewrite: `apps/ui/src/lib/project-canvas/panels/workload-terminal-panel.tsx` — thin AP adapter over `ExecTerminalPane`.
- Create: `apps/ui/src/lib/project-canvas/panels/database-console-pane.tsx` — thin DB adapter.
- Modify: `apps/ui/src/lib/project-canvas/panels/workload-pane-mode.ts` + `apps/ui/src/store/canvas-store.tsx` — allow the terminal plane for DB nodes.
- Modify: `apps/ui/src/hooks/use-project-canvas.ts` — wire the DB node `console` quick action + telemetry.
- Modify: `apps/ui/src/app/project/[uid]/page.tsx` — render the DB console in the bottom plane.

---

## Phase A — Backend

### Task A1: Per-engine console command builder (pure, TDD)

**Files:**
- Create: `apps/api/service/db/console.go`
- Test: `apps/api/service/db/console_test.go`

- [ ] **Step 1: Write the failing test**

```go
package db

import (
	"reflect"
	"testing"
)

func TestConsoleCommandForEngine(t *testing.T) {
	conn := ConsoleConnection{
		Host: "demo.ns.svc", Port: "5432",
		Username: "u", Password: "p@s/s", Database: "appdb",
	}
	cases := []struct {
		engine        string
		wantContainer string
		wantContains  string
	}{
		{"postgresql", "postgresql", `psql "postgresql://u:p%40s%2Fs@demo.ns.svc:5432/appdb"`},
		{"mysql", "mysql", `mysql -h demo.ns.svc -P 5432 -u u -p'p@s/s'`},
		{"mongodb", "mongodb", `mongosh "mongodb://u:p%40s%2Fs@demo.ns.svc:5432/appdb?authSource=admin"`},
		{"redis", "redis", `redis-cli -u "redis://u:p%40s%2Fs@demo.ns.svc:5432"`},
	}
	for _, tc := range cases {
		cmd, container, err := consoleCommandForEngine(tc.engine, conn)
		if err != nil {
			t.Fatalf("%s: unexpected err %v", tc.engine, err)
		}
		if container != tc.wantContainer {
			t.Fatalf("%s: container=%q want %q", tc.engine, container, tc.wantContainer)
		}
		want := []string{"sh", "-lc", tc.wantContains}
		if !reflect.DeepEqual(cmd, want) {
			t.Fatalf("%s:\n got %#v\nwant %#v", tc.engine, cmd, want)
		}
	}
	if _, _, err := consoleCommandForEngine("kafka", conn); err == nil {
		t.Fatal("kafka: expected unsupported error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && go test ./service/db/ -run TestConsoleCommandForEngine -v`
Expected: FAIL — `consoleCommandForEngine`/`ConsoleConnection` undefined.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/service/db/console.go`:

```go
package db

import (
	"fmt"
	"net/url"
	"strings"
)

// ConsoleConnection is the resolved, server-side connection target for a DB Console.
type ConsoleConnection struct {
	Host     string
	Port     string
	Username string
	Password string
	Database string
}

// consoleEngineComponent maps a DB spec.engine to the KubeBlocks component/container name.
func consoleEngineComponent(engine string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "postgresql", "postgres", "pg":
		return "postgresql", nil
	case "mysql":
		return "mysql", nil
	case "mongodb", "mongo":
		return "mongodb", nil
	case "redis":
		return "redis", nil
	default:
		return "", fmt.Errorf("%w: %s", ErrAccessHealthUnsupported, engine)
	}
}

// consoleCommandForEngine returns the exec command (wrapped in sh -lc) and the
// target container name for the engine's native client.
func consoleCommandForEngine(engine string, conn ConsoleConnection) ([]string, string, error) {
	component, err := consoleEngineComponent(engine)
	if err != nil {
		return nil, "", err
	}
	hostPort := conn.Host + ":" + conn.Port
	userInfo := url.UserPassword(conn.Username, conn.Password)

	var inline string
	switch component {
	case "postgresql":
		u := url.URL{Scheme: "postgresql", User: userInfo, Host: hostPort, Path: "/" + conn.Database}
		inline = fmt.Sprintf("psql %q", u.String())
	case "mysql":
		inline = fmt.Sprintf("mysql -h %s -P %s -u %s -p'%s'", conn.Host, conn.Port, conn.Username, conn.Password)
	case "mongodb":
		u := url.URL{Scheme: "mongodb", User: userInfo, Host: hostPort, Path: "/" + conn.Database, RawQuery: "authSource=admin"}
		inline = fmt.Sprintf("mongosh %q", u.String())
	case "redis":
		u := url.URL{Scheme: "redis", User: userInfo, Host: hostPort}
		inline = fmt.Sprintf("redis-cli -u %q", u.String())
	}
	return []string{"sh", "-lc", inline}, component, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && go test ./service/db/ -run TestConsoleCommandForEngine -v`
Expected: PASS. (If the URL-encoding of `p@s/s` differs, fix the test's expected string to match Go's `net/url` output — do not weaken the implementation.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/service/db/console.go apps/api/service/db/console_test.go
git commit -m "feat(db): add per-engine DB console command builder"
```

### Task A2: Leader-pod selection from InstanceSet members (pure, TDD)

**Files:**
- Modify: `apps/api/service/db/console.go`
- Test: `apps/api/service/db/console_test.go`

- [ ] **Step 1: Write the failing test** (append to `console_test.go`)

```go
func TestSelectConsoleLeaderPod(t *testing.T) {
	members := []InstanceSetMember{
		{PodName: "db-postgresql-1", IsLeader: false},
		{PodName: "db-postgresql-0", IsLeader: true},
	}
	if got, _ := selectConsoleLeaderPod(members); got != "db-postgresql-0" {
		t.Fatalf("leader: got %q want db-postgresql-0", got)
	}
	// No leader flagged → first member with a pod name.
	fallback := []InstanceSetMember{{PodName: ""}, {PodName: "db-redis-0"}}
	if got, _ := selectConsoleLeaderPod(fallback); got != "db-redis-0" {
		t.Fatalf("fallback: got %q want db-redis-0", got)
	}
	if _, err := selectConsoleLeaderPod(nil); err == nil {
		t.Fatal("empty: expected error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && go test ./service/db/ -run TestSelectConsoleLeaderPod -v`
Expected: FAIL — `InstanceSetMember`/`selectConsoleLeaderPod` undefined.

- [ ] **Step 3: Write minimal implementation** (append to `console.go`)

```go
// InstanceSetMember is one KubeBlocks InstanceSet member (status.membersStatus[]).
type InstanceSetMember struct {
	PodName  string
	IsLeader bool
}

var errNoConsoleMembers = errors.New("no available db pod for console")

func selectConsoleLeaderPod(members []InstanceSetMember) (string, error) {
	var fallback string
	for _, m := range members {
		if strings.TrimSpace(m.PodName) == "" {
			continue
		}
		if fallback == "" {
			fallback = m.PodName
		}
		if m.IsLeader {
			return m.PodName, nil
		}
	}
	if fallback == "" {
		return "", errNoConsoleMembers
	}
	return fallback, nil
}
```

Add `"errors"` to the import block in `console.go`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && go test ./service/db/ -run TestSelectConsoleLeaderPod -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/service/db/console.go apps/api/service/db/console_test.go
git commit -m "feat(db): add InstanceSet leader-pod selection for console"
```

### Task A3: Console exec resolver + store method

**Files:**
- Modify: `apps/api/service/db/console.go`
- Modify: `apps/api/service/db/access_health_store.go`

- [ ] **Step 1: Add the store method** — in `access_health_store.go`, add the InstanceSet GVR and a reader.

```go
var consoleInstanceSetGVRs = []schema.GroupVersionResource{
	{Group: "workloads.kubeblocks.io", Version: "v1", Resource: "instancesets"},
	{Group: "workloads.kubeblocks.io", Version: "v1alpha1", Resource: "instancesets"},
}

// GetInstanceSetMembers reads status.membersStatus from the KubeBlocks InstanceSet
// named "<dbName>-<component>", trying each supported API version.
func (s *KubernetesAccessHealthStore) GetInstanceSetMembers(ctx context.Context, namespace, dbName, component string) ([]InstanceSetMember, error) {
	name := dbName + "-" + component
	var lastErr error
	for _, gvr := range consoleInstanceSetGVRs {
		obj, err := s.dynamic.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			lastErr = err
			continue
		}
		raw, _, _ := unstructured.NestedSlice(obj.Object, "status", "membersStatus")
		members := make([]InstanceSetMember, 0, len(raw))
		for _, item := range raw {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			pod, _, _ := unstructured.NestedString(m, "podName")
			leader, _, _ := unstructured.NestedBool(m, "role", "isLeader")
			members = append(members, InstanceSetMember{PodName: pod, IsLeader: leader})
		}
		return members, nil
	}
	return nil, lastErr
}
```

- [ ] **Step 2: Add the resolver + store interface** — in `console.go`:

```go
// ConsoleExecStore is the data dependency for resolving a DB Console exec target.
type ConsoleExecStore interface {
	AccessHealthStore
	GetInstanceSetMembers(ctx context.Context, namespace, dbName, component string) ([]InstanceSetMember, error)
}

// ConsoleExecTarget is the resolved pod + command for a DB Console session.
type ConsoleExecTarget struct {
	Namespace string
	Pod       string
	Container string
	Command   []string
	Engine    string
}

type ConsoleExecRequest struct {
	Name       string
	Namespace  string
	ProjectUID string
}

// ResolveConsoleExecTarget reuses guardDBAccess (ownership + readiness + credentials),
// then resolves the leader pod and builds the engine client command — all server-side.
func ResolveConsoleExecTarget(ctx context.Context, store ConsoleExecStore, req ConsoleExecRequest) (ConsoleExecTarget, error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectUID = strings.TrimSpace(req.ProjectUID)
	if req.ProjectUID == "" {
		return ConsoleExecTarget{}, ErrAccessHealthProjectUID
	}

	engine, creds, err := guardDBAccess(ctx, store, guardedAccessRequest{
		Name: req.Name, Namespace: req.Namespace, ProjectUID: req.ProjectUID,
	})
	if err != nil {
		return ConsoleExecTarget{}, err
	}

	component, err := consoleEngineComponent(engine)
	if err != nil {
		return ConsoleExecTarget{}, err
	}
	members, err := store.GetInstanceSetMembers(ctx, req.Namespace, req.Name, component)
	if err != nil {
		return ConsoleExecTarget{}, err
	}
	pod, err := selectConsoleLeaderPod(members)
	if err != nil {
		return ConsoleExecTarget{}, err
	}

	conn := ConsoleConnection{
		Host:     creds.Values["Hostname"],
		Port:     creds.Values["Port"],
		Username: creds.Values["Username"],
		Password: creds.Values["Password"],
		Database: creds.Values["Database"],
	}
	command, container, err := consoleCommandForEngine(engine, conn)
	if err != nil {
		return ConsoleExecTarget{}, err
	}
	return ConsoleExecTarget{
		Namespace: req.Namespace, Pod: pod, Container: container, Command: command, Engine: engine,
	}, nil
}
```

- [ ] **Step 3: Build**

Run: `cd apps/api && go build ./...`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/service/db/console.go apps/api/service/db/access_health_store.go
git commit -m "feat(db): resolve DB console exec target (leader pod + creds + command)"
```

### Task A4: Wire `kind` + `resize` into the exec WebSocket

**Files:**
- Modify: `apps/api/service/k8s/exec.go:115` (`StreamPodExec` signature)
- Modify: `apps/api/route/k8s/exec_ws.go`

- [ ] **Step 1: Add a terminal-size channel to `StreamPodExec`** — change the signature and `StreamOptions`:

```go
func StreamPodExec(
	ctx context.Context,
	restConfig *rest.Config,
	target APWorkloadExecTarget,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
	resize <-chan remotecommand.TerminalSize,
) error {
```

Inside, wrap the channel as a queue and pass it:

```go
	var sizeQueue remotecommand.TerminalSizeQueue
	if resize != nil {
		sizeQueue = &channelSizeQueue{ch: resize}
	}
	// ...
	done <- executor.StreamWithContext(streamCtx, remotecommand.StreamOptions{
		Stdin:             stdin,
		Stdout:            stdout,
		Stderr:            stderr,
		Tty:               true,
		TerminalSizeQueue: sizeQueue,
	})
```

Add at the bottom of `exec.go`:

```go
type channelSizeQueue struct{ ch <-chan remotecommand.TerminalSize }

func (q *channelSizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.ch
	if !ok {
		return nil
	}
	return &size
}
```

- [ ] **Step 2: Update the protocol + handler** in `exec_ws.go`:
  - Add to `execClientMessage`: `Kind string`, `ProjectUID string`, `Cols uint16`, `Rows uint16`.
  - Add message-type const `execMessageTypeResize = "resize"`.
  - Create a `resize := make(chan remotecommand.TerminalSize, 1)` and pass it to `StreamPodExec`.
  - In the read loop, handle `execMessageTypeResize` by non-blocking send to `resize`.
  - After `RestConfigFromAuth` + `ResolveContext`, branch on `initMsg.Kind`:

```go
	var target k8ssvc.APWorkloadExecTarget
	if strings.EqualFold(initMsg.Kind, "db") {
		store, serr := dbsvc.NewKubernetesAccessHealthStore(resolved.RestConfig)
		if serr != nil {
			writeExecError(conn, "failed to initialize DB console store")
			return
		}
		ct, rerr := dbsvc.ResolveConsoleExecTarget(ctx, store, dbsvc.ConsoleExecRequest{
			Name: initMsg.Name, Namespace: resolved.Namespace, ProjectUID: initMsg.ProjectUID,
		})
		if rerr != nil {
			writeExecError(conn, execErrorMessage(rerr))
			return
		}
		target = k8ssvc.APWorkloadExecTarget{
			Namespace: ct.Namespace, Pod: ct.Pod, Container: ct.Container, Command: ct.Command,
		}
	} else {
		var terr error
		target, terr = k8ssvc.ResolveAPWorkloadExecTarget(ctx, restConfig, k8ssvc.APWorkloadExecTargetOptions{
			Command: initMsg.Command, Container: initMsg.Container, Name: initMsg.Name, Namespace: resolved.Namespace,
		})
		if terr != nil {
			writeExecError(conn, execErrorMessage(terr))
			return
		}
	}
```

  - Add `dbsvc "sealos/api/service/db"` to imports; update the `StreamPodExec` call to pass `resize`; close `resize` in the read-loop's deferred cleanup.

- [ ] **Step 3: Build + run existing k8s/db tests**

Run: `cd apps/api && go build ./... && go test ./service/... ./route/k8s/... ./route/db/...`
Expected: builds clean; existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/service/k8s/exec.go apps/api/route/k8s/exec_ws.go
git commit -m "feat(api): branch exec WebSocket to DB console + support terminal resize"
```

---

## Phase B — Frontend

### Task B1: Add xterm dependencies

- [ ] **Step 1:** `cd apps/ui && bun add @xterm/xterm @xterm/addon-fit`
- [ ] **Step 2:** Verify they appear in `apps/ui/package.json` dependencies.
- [ ] **Step 3: Commit** `git add apps/ui/package.json bun.lock && git commit -m "chore(ui): add xterm.js"`

### Task B2: Shared `ExecTerminalPane` (xterm) + AP adapter

**Files:**
- Create: `apps/ui/src/lib/project-canvas/panels/exec-terminal-pane.tsx`
- Rewrite: `apps/ui/src/lib/project-canvas/panels/workload-terminal-panel.tsx`

- [ ] **Step 1:** In `exec-terminal-pane.tsx`, define the descriptor and a client-only component:

```ts
export interface ExecTerminalDescriptor {
  kind: "ap" | "db";
  name: string;
  namespace: string;
  projectUid?: string;
  title: string;
  subtitle: string;
  /** Stable key; remounts/reconnects when it changes. */
  sessionKey: string;
}
```

The component:
- imports `@xterm/xterm` CSS + `Terminal`, `FitAddon` (load with `useEffect` to stay SSR-safe; the file is already `"use client"`),
- opens the WebSocket via `workloadTerminalWebSocketUrl()`,
- sends `{ type:"init", kind, kubeconfig, name, namespace, projectUid }`,
- on `ready` writes the connected banner; on `output` calls `term.write(value)`; on `error` writes the message in red,
- `term.onData(d => socket.send(JSON.stringify({ type:"input", value:d })))`,
- on fit/resize sends `{ type:"resize", cols, rows }`,
- renders the same bottom-plane chrome currently in `WorkloadTerminalPane` (header with title/subtitle/close, a `ref` div for `term.open`).

Reuse the existing `kubeconfigAtom`/`namespaceAtom`, `workloadTerminalWebSocketUrl`, and the `TerminalServerMessage` type (move it here).

- [ ] **Step 2:** Rewrite `workload-terminal-panel.tsx` so `WorkloadTerminalPane` computes an AP descriptor from `containerStatesFromNode(node)` (`kind:"ap"`, `name`, `namespace`, title from name, subtitle from image) and renders `<ExecTerminalPane descriptor={...} onClose={onClose} />`.

- [ ] **Step 3: Verify** `bun typecheck && bun check` pass; run the app and confirm the **AP** terminal still connects and renders (regression check before adding DB).

- [ ] **Step 4: Commit** `git commit -am "refactor(ui): extract xterm-based ExecTerminalPane; AP terminal uses it"`

### Task B3: DB console adapter

**Files:**
- Create: `apps/ui/src/lib/project-canvas/panels/database-console-pane.tsx`

- [ ] **Step 1:** Add `databaseConsoleTargetFromNode(node)` (mirror `containerStatesFromNode`, reading the DB node's `states` for `name`/`namespace` and the project uid available on the node data).
- [ ] **Step 2:** `DatabaseConsolePane` builds a `kind:"db"` descriptor (title = db name, subtitle = `${engine} console`) and renders `<ExecTerminalPane>`.
- [ ] **Step 3: Verify** `bun typecheck && bun check`.
- [ ] **Step 4: Commit** `git commit -am "feat(ui): add DatabaseConsolePane adapter"`

### Task B4: Allow the terminal plane for DB nodes + wire the quick action

**Files:**
- Modify: `apps/ui/src/store/canvas-store.tsx` (add `DATABASE_PANE.console`)
- Modify: `apps/ui/src/lib/project-canvas/panels/workload-pane-mode.ts` (or a db equivalent) so the plane opens for a selected DB node
- Modify: `apps/ui/src/hooks/use-project-canvas.ts` (DB `quickActions.console.onClick`)
- Modify: `apps/ui/src/app/project/[uid]/page.tsx` (render `DatabaseConsolePane` in the bottom plane when a DB node is selected and `databasePane === console`)

- [ ] **Step 1:** Add `console: "console"` to `DATABASE_PANE`. Mirror the AP `terminalPlaneOpen` derivation for the DB pane so the bottom plane opens when `databasePane === DATABASE_PANE.console`.
- [ ] **Step 2:** In `use-project-canvas.ts` DB quick-actions block (the same object that defines `dbAccess`/`metrics`, ~line 466), add:

```ts
console: {
  disabled: !hasUrlActions,
  onClick: hasUrlActions
    ? () => {
        requestSettingsLeave("switch", () => {
          setCanvasAction(null).catch(() => undefined);
          setSelectedEdge(null);
          setServiceUid(uid).catch(() => undefined);
          setEntryPane(null).catch(() => undefined);
          setWorkloadPane(null).catch(() => undefined);
          setDatabasePane(DATABASE_PANE.console).catch(() => undefined);
        });
      }
    : undefined,
},
```

- [ ] **Step 3:** In `page.tsx`, where the bottom terminal plane is rendered, render `DatabaseConsolePane` for a selected DB node when the DB console pane is active (mirror the existing `terminalPlaneOpen` rendering for AP).
- [ ] **Step 4: Verify** `bun typecheck && bun check`; run the app, open a DB node's console button, confirm a live `psql`/`redis-cli` session.
- [ ] **Step 5: Commit** `git commit -am "feat(ui): wire DB node console quick action to the console pane"`

### Task B5: Telemetry (session-open only)

- [ ] **Step 1:** On opening the DB console pane, fire the project's existing telemetry/track hook with a `db_console_open` event carrying `{ db name, engine, namespace }`. No command content (ADR-0013).
- [ ] **Step 2: Verify + Commit** `git commit -am "feat(ui): emit db_console_open telemetry"`

---

## Self-Review

**Spec coverage:** ADR-0013 decisions all mapped — native client via pod-exec (A1/A4), leader pod (A2/A3), server-side credentials (A3 reuses `guardDBAccess`), engine whitelist (A1 `consoleEngineComponent` errors on unsupported → console hidden/disabled in B4), session-open telemetry only (B5). xterm.js + resize debt (B1–B4, A4). Shared component with thin adapters (B2/B3).

**Placeholder scan:** Backend tasks contain complete code. Frontend B2–B5 describe concrete file edits and the descriptor contract; xterm wiring lists the exact API calls (`term.write`, `term.onData`, `FitAddon`, `{type:"resize",cols,rows}`) rather than vague "wire it up". Acceptable because the shared chrome is copied from the existing `WorkloadTerminalPane`.

**Type consistency:** `kind:"ap"|"db"`, `ExecTerminalDescriptor`, `ConsoleConnection`, `ConsoleExecTarget`, `InstanceSetMember`, `DATABASE_PANE.console` are used consistently across tasks. `StreamPodExec`'s new trailing `resize` param is updated at its one call site (A4).

**Engine gating:** `consoleCommandForEngine` returns `ErrAccessHealthUnsupported` for non-pg/mysql/mongo/redis; the DB node should hide/disable `console` for engines without a client (kafka/qdrant/milvus/nebula/weaviate/pulsar) — confirm during B4.
