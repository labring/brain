package db

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

var errNoConsoleMembers = errors.New("no available db pod for console")

// ConsoleConnection is the resolved, server-side connection target for a DB Console.
type ConsoleConnection struct {
	Host     string
	Port     string
	Username string
	Password string
	Database string
}

// InstanceSetMember is one KubeBlocks InstanceSet member (status.membersStatus[]).
type InstanceSetMember struct {
	PodName  string
	IsLeader bool
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
// target container name for the engine's native client. The password is embedded
// server-side; it never transits the browser (see ADR-0013).
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

// selectConsoleLeaderPod picks the writable primary pod, falling back to the first
// member that has a pod name.
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

// ConsoleExecRequest identifies the DB whose console is being opened.
type ConsoleExecRequest struct {
	Name       string
	Namespace  string
	ProjectUID string
}

// ResolveConsoleExecTarget reuses guardDBAccess (ownership + readiness + credentials),
// then resolves the KubeBlocks leader pod and builds the engine client command. All
// credential handling stays server-side (ADR-0013).
func ResolveConsoleExecTarget(ctx context.Context, store ConsoleExecStore, req ConsoleExecRequest) (ConsoleExecTarget, error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectUID = strings.TrimSpace(req.ProjectUID)
	if req.ProjectUID == "" {
		return ConsoleExecTarget{}, ErrAccessHealthProjectUID
	}

	engine, creds, err := guardDBAccess(ctx, store, guardedAccessRequest{
		Name:       req.Name,
		Namespace:  req.Namespace,
		ProjectUID: req.ProjectUID,
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
		Namespace: req.Namespace,
		Pod:       pod,
		Container: container,
		Command:   command,
		Engine:    engine,
	}, nil
}
