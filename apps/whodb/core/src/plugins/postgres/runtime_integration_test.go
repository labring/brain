//go:build integration

/*
 * Copyright 2026 Clidey, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package postgres

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/clidey/whodb/core/src/engine"
	"github.com/clidey/whodb/core/src/query"
)

func postgresIntegrationPlugin(t *testing.T) *PostgresPlugin {
	t.Helper()

	plugin, ok := NewPostgresPlugin().PluginFunctions.(*PostgresPlugin)
	if !ok {
		t.Fatalf("unexpected postgres plugin type %T", NewPostgresPlugin().PluginFunctions)
	}
	return plugin
}

func postgresIntegrationConfig() *engine.PluginConfig {
	credentials := &engine.Credentials{
		Type:     string(engine.DatabaseType_Postgres),
		Hostname: "localhost",
		Username: "user",
		Password: "jio53$*(@nfe)",
		Database: "test_db",
	}
	if port := os.Getenv("WHODB_POSTGRES_INTEGRATION_PORT"); port != "" {
		credentials.Advanced = []engine.Record{{Key: "Port", Value: port}}
	}
	return engine.NewPluginConfig(credentials)
}

func waitForPostgresOrders(t *testing.T, plugin *PostgresPlugin, config *engine.PluginConfig) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		if !plugin.IsAvailable(context.Background(), config) {
			time.Sleep(2 * time.Second)
			continue
		}

		exists, err := plugin.StorageUnitExists(config, "test_schema", "orders")
		if err == nil && exists {
			rows, rowsErr := plugin.GetRows(config, &engine.GetRowsRequest{
				Schema:      "test_schema",
				StorageUnit: "orders",
				Sort:        []*query.SortCondition{{Column: "id", Direction: query.SortDirectionAsc}},
				PageSize:    1,
			})
			if rowsErr == nil && len(rows.Rows) > 0 {
				return
			}
		}

		time.Sleep(2 * time.Second)
	}

	t.Fatal("timed out waiting for seeded postgres data")
}

func findPostgresColumn(t *testing.T, columns []engine.Column, name string) engine.Column {
	t.Helper()

	for _, column := range columns {
		if column.Name == name {
			return column
		}
	}

	t.Fatalf("column %q not found in %#v", name, columns)
	return engine.Column{}
}

func quotePostgresTestIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func TestPostgresStorageUnitExistsPreservesQuotedTableNames(t *testing.T) {
	plugin := postgresIntegrationPlugin(t)
	config := postgresIntegrationConfig()
	waitForPostgresOrders(t, plugin, config)

	suffix := time.Now().UnixNano()
	tableNames := []string{
		fmt.Sprintf("Account%d", suffix),
		fmt.Sprintf("account history %d", suffix),
		fmt.Sprintf("account%[1]d\"archive", suffix),
	}

	for _, tableName := range tableNames {
		t.Run(tableName, func(t *testing.T) {
			quotedTableName := quotePostgresTestIdentifier(tableName)
			if _, err := plugin.RawExecute(config, fmt.Sprintf(
				"CREATE TABLE test_schema.%s (id INTEGER)",
				quotedTableName,
			)); err != nil {
				t.Fatalf("failed to create quoted postgres table %q: %v", tableName, err)
			}
			t.Cleanup(func() {
				_, _ = plugin.RawExecute(config, fmt.Sprintf(
					"DROP TABLE IF EXISTS test_schema.%s",
					quotedTableName,
				))
			})

			exists, err := plugin.StorageUnitExists(config, "test_schema", tableName)
			if err != nil {
				t.Fatalf("StorageUnitExists failed for quoted table %q: %v", tableName, err)
			}
			if !exists {
				t.Fatalf("expected quoted postgres table %q to exist", tableName)
			}
		})
	}
}

func TestPostgresSeededRuntimePaths(t *testing.T) {
	plugin := postgresIntegrationPlugin(t)
	config := postgresIntegrationConfig()
	waitForPostgresOrders(t, plugin, config)

	databases, err := plugin.GetDatabases(config)
	if err != nil {
		t.Fatalf("GetDatabases failed: %v", err)
	}
	if !slices.Contains(databases, "test_db") {
		t.Fatalf("expected databases %#v to contain test_db", databases)
	}

	rawRows, err := plugin.RawExecute(config, "SELECT status FROM test_schema.orders ORDER BY id LIMIT 1")
	if err != nil {
		t.Fatalf("RawExecute failed: %v", err)
	}
	if len(rawRows.Rows) != 1 {
		t.Fatalf("expected one postgres row, got %#v", rawRows.Rows)
	}

	relationships, err := plugin.GetForeignKeyRelationships(config, "test_schema", "orders")
	if err != nil {
		t.Fatalf("GetForeignKeyRelationships failed: %v", err)
	}
	relationship, ok := relationships["user_id"]
	if !ok {
		t.Fatalf("expected user_id foreign key in %#v", relationships)
	}
	if relationship.ReferencedTable != "users" || relationship.ReferencedColumn != "id" {
		t.Fatalf("unexpected postgres foreign key relationship %#v", relationship)
	}

	sslStatus, err := plugin.GetSSLStatus(config)
	if err != nil {
		t.Fatalf("GetSSLStatus failed: %v", err)
	}
	if sslStatus.IsEnabled || sslStatus.Mode != "disabled" {
		t.Fatalf("expected postgres SSL to be disabled, got %#v", sslStatus)
	}

	table := fmt.Sprintf("intg_pg_ms_%d", time.Now().UnixNano())
	_, _ = plugin.RawExecute(config, fmt.Sprintf("DROP TABLE IF EXISTS test_schema.%s", table))
	defer plugin.RawExecute(config, fmt.Sprintf("DROP TABLE IF EXISTS test_schema.%s", table))

	multiStatementConfig := *config
	multiStatementConfig.MultiStatement = true

	_, err = plugin.RawExecute(&multiStatementConfig, fmt.Sprintf(`
DROP TABLE IF EXISTS test_schema.%[1]s;
CREATE TABLE test_schema.%[1]s (
	id SERIAL PRIMARY KEY,
	name TEXT NOT NULL
);
INSERT INTO test_schema.%[1]s (name) VALUES ('alpha'), ('beta');
`, table))
	if err != nil {
		t.Fatalf("multi-statement RawExecute failed: %v", err)
	}

	exists, err := plugin.StorageUnitExists(config, "test_schema", table)
	if err != nil || !exists {
		t.Fatalf("expected postgres table %q to exist, exists=%t err=%v", table, exists, err)
	}

	insertedRows, err := plugin.RawExecute(config, fmt.Sprintf("SELECT name FROM test_schema.%s ORDER BY id", table))
	if err != nil {
		t.Fatalf("failed to read multi-statement postgres table: %v", err)
	}
	if len(insertedRows.Rows) != 2 {
		t.Fatalf("expected two postgres rows after multi-statement RawExecute, got %#v", insertedRows.Rows)
	}
}

func TestPostgresGeneratedColumns(t *testing.T) {
	plugin := postgresIntegrationPlugin(t)
	config := postgresIntegrationConfig()
	waitForPostgresOrders(t, plugin, config)

	table := fmt.Sprintf("intg_pg_gen_%d", time.Now().UnixNano())
	_, _ = plugin.RawExecute(config, fmt.Sprintf("DROP TABLE IF EXISTS test_schema.%s", table))
	defer plugin.RawExecute(config, fmt.Sprintf("DROP TABLE IF EXISTS test_schema.%s", table))

	_, err := plugin.RawExecute(config, fmt.Sprintf(`
CREATE TABLE test_schema.%[1]s (
	id SERIAL PRIMARY KEY,
	subtotal INT NOT NULL,
	tax INT NOT NULL,
	total INT GENERATED ALWAYS AS (subtotal + tax) STORED
)
`, table))
	if err != nil {
		t.Fatalf("failed to create postgres generated-column table: %v", err)
	}

	columns, err := plugin.GetColumnsForTable(config, "test_schema", table)
	if err != nil {
		t.Fatalf("GetColumnsForTable failed: %v", err)
	}
	if err := plugin.MarkGeneratedColumns(config, "test_schema", table, columns); err != nil {
		t.Fatalf("MarkGeneratedColumns failed: %v", err)
	}
	if !findPostgresColumn(t, columns, "total").IsComputed {
		t.Fatalf("expected total column to be marked as computed, got %#v", columns)
	}
}
