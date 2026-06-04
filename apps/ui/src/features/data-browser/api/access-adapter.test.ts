import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  accessRowsToDataFlowTableData,
  DATA_BROWSER_EXPORT_FORMATS,
  exportObject,
  getRows,
} from "./access-adapter";
import type {
  AccessObjectRef,
  AccessRowsResult,
  DataBrowserHostContext,
} from "./access-types";

const runtime = {
  database: {
    displayEngine: "PostgreSQL",
    formattedVersion: "16.4",
    name: "orders-db",
  },
  databaseWorkloadName: "orders/db claim",
  databaseWorkloadNamespace: "database-system",
  engine: "POSTGRES",
  kubeconfig: " kube config\n",
  namespace: "project-ns",
  projectId: "project-uid",
} satisfies DataBrowserHostContext;

const tableRef = {
  kind: "table",
  path: ["orders", "public", "users"],
} satisfies AccessObjectRef;

const originalFetch = globalThis.fetch;

function installFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init, "fetch init should be provided");
    return handler(String(input), init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("access rows request encodes kubeconfig bearer and workload namespace", async () => {
  let capturedBody: unknown;
  const restoreFetch = installFetch((url, init) => {
    assert.equal(url, "/api/db/v1alpha1/orders%2Fdb%20claim/access/rows");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer kube%20config"
    );
    capturedBody = JSON.parse(String(init.body));
    return Response.json({
      ref: tableRef,
      columns: [],
      rows: [],
      pageSize: 50,
      pageOffset: 100,
      totalCount: 0,
    } satisfies AccessRowsResult);
  });

  try {
    await getRows({
      runtime,
      ref: tableRef,
      pageSize: 50,
      pageOffset: 100,
      sort: [{ column: "created_at", direction: "DESC" }],
    });
  } finally {
    restoreFetch();
  }

  assert.deepEqual(capturedBody, {
    projectId: "project-uid",
    namespace: "database-system",
    ref: tableRef,
    pageSize: 50,
    pageOffset: 100,
    sort: [{ column: "created_at", direction: "DESC" }],
  });
});

test("visible rows helper does not send hidden query or filter fields", async () => {
  let capturedBody: Record<string, unknown> = {};
  const restoreFetch = installFetch((_url, init) => {
    capturedBody = JSON.parse(String(init.body));
    return Response.json({
      ref: tableRef,
      columns: [],
      rows: [],
      pageSize: 25,
      pageOffset: 0,
      totalCount: 0,
    } satisfies AccessRowsResult);
  });

  try {
    await getRows({
      runtime,
      ref: tableRef,
      pageSize: 25,
      pageOffset: 0,
    });
  } finally {
    restoreFetch();
  }

  assert.equal("query" in capturedBody, false);
  assert.equal("where" in capturedBody, false);
  assert.equal("filter" in capturedBody, false);
});

test("visible export helper does not send selected rows or query-backed payload", async () => {
  let capturedBody: Record<string, unknown> = {};
  const restoreFetch = installFetch((_url, init) => {
    capturedBody = JSON.parse(String(init.body));
    return new Response("id\n1\n", {
      headers: {
        "Content-Disposition": 'attachment; filename="users.csv"',
        "Content-Type": "text/csv",
      },
    });
  });

  try {
    const result = await exportObject({
      runtime,
      ref: tableRef,
      format: "csv",
    });
    assert.equal(result.filename, "users.csv");
  } finally {
    restoreFetch();
  }

  assert.deepEqual(capturedBody, {
    projectId: "project-uid",
    namespace: "database-system",
    format: "csv",
    ref: tableRef,
  });
  assert.equal("selectedRows" in capturedBody, false);
  assert.equal("query" in capturedBody, false);
  assert.equal("where" in capturedBody, false);
  assert.equal("filter" in capturedBody, false);
});

test("visible export formats are limited to backend-safe formats", () => {
  assert.deepEqual([...DATA_BROWSER_EXPORT_FORMATS], ["csv", "ndjson"]);
});

test("visible export falls back to a safe filename when header is absent", async () => {
  const restoreFetch = installFetch((_url, _init) => {
    return new Response("{}", {
      headers: {
        "Content-Type": "application/x-ndjson",
      },
    });
  });

  try {
    const result = await exportObject({
      runtime,
      ref: {
        kind: "collection",
        path: ["sales/db", "events 2026"],
      },
      format: "ndjson",
    });
    assert.equal(result.filename, "events_2026.ndjson");
  } finally {
    restoreFetch();
  }
});

test("rows conversion preserves columns, types, primary and foreign keys", () => {
  const tableData = accessRowsToDataFlowTableData({
    ref: tableRef,
    columns: [
      {
        name: "id",
        type: "integer",
        isPrimary: true,
        isForeignKey: false,
      },
      {
        name: "team_id",
        type: "integer",
        isPrimary: false,
        isForeignKey: true,
        referencedTable: "teams",
        referencedColumn: "id",
      },
      {
        name: "email",
        type: "varchar",
        isPrimary: false,
        isForeignKey: false,
      },
    ],
    rows: [
      ["1", "42", "ada@example.com"],
      ["2", "", undefined as unknown as string],
    ],
    pageSize: 50,
    pageOffset: 0,
    totalCount: 2,
  });

  assert.deepEqual(tableData.columns, ["id", "team_id", "email"]);
  assert.deepEqual(tableData.columnTypes, {
    id: "integer",
    team_id: "integer",
    email: "varchar",
  });
  assert.deepEqual(tableData.rows, [
    { id: "1", team_id: "42", email: "ada@example.com" },
    { id: "2", team_id: null, email: null },
  ]);
  assert.equal(tableData.primaryKey, "id");
  assert.deepEqual(tableData.foreignKeyColumns, ["team_id"]);
  assert.equal(tableData.total, 2);
  assert.equal(tableData.disableUpdate, true);
});
