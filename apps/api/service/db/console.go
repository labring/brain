package db

import (
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
