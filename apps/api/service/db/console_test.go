package db

import (
	"reflect"
	"testing"
)

func TestConsoleCommandForEngine(t *testing.T) {
	conn := ConsoleConnection{
		Host:     "demo.ns.svc",
		Port:     "5432",
		Username: "u",
		Password: "p@s/s",
		Database: "appdb",
	}
	cases := []struct {
		engine        string
		wantContainer string
		wantInline    string
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
		want := []string{"sh", "-lc", tc.wantInline}
		if !reflect.DeepEqual(cmd, want) {
			t.Fatalf("%s:\n got %#v\nwant %#v", tc.engine, cmd, want)
		}
	}
	if _, _, err := consoleCommandForEngine("kafka", conn); err == nil {
		t.Fatal("kafka: expected unsupported error")
	}
}

func TestSelectConsoleLeaderPod(t *testing.T) {
	members := []InstanceSetMember{
		{PodName: "db-postgresql-1", IsLeader: false},
		{PodName: "db-postgresql-0", IsLeader: true},
	}
	if got, _ := selectConsoleLeaderPod(members); got != "db-postgresql-0" {
		t.Fatalf("leader: got %q want db-postgresql-0", got)
	}
	fallback := []InstanceSetMember{{PodName: ""}, {PodName: "db-redis-0"}}
	if got, _ := selectConsoleLeaderPod(fallback); got != "db-redis-0" {
		t.Fatalf("fallback: got %q want db-redis-0", got)
	}
	if _, err := selectConsoleLeaderPod(nil); err == nil {
		t.Fatal("empty: expected error")
	}
}
