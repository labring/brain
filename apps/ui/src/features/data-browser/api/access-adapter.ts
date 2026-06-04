import type {
  AccessColumnsResult,
  AccessObjectRef,
  AccessObjectResult,
  AccessObjectsResult,
  AccessRowsResult,
  AccessRowsSort,
  DataBrowserHostContext,
  DataFlowTableData,
} from "./access-types";

interface AccessRequestInput {
  body?: Record<string, unknown>;
  operation: string;
  runtime: DataBrowserHostContext;
}

export interface ListObjectsInput {
  kinds?: string[];
  parent?: AccessObjectRef;
  runtime: DataBrowserHostContext;
}

export interface GetObjectInput {
  ref: AccessObjectRef;
  runtime: DataBrowserHostContext;
}

export interface GetColumnsInput {
  ref: AccessObjectRef;
  runtime: DataBrowserHostContext;
}

export interface GetRowsInput {
  pageOffset: number;
  pageSize: number;
  ref: AccessObjectRef;
  runtime: DataBrowserHostContext;
  sort?: AccessRowsSort[];
}

export type AccessExportFormat = "csv" | "ndjson";

export interface ExportObjectInput {
  format: AccessExportFormat;
  ref: AccessObjectRef;
  runtime: DataBrowserHostContext;
}

export interface ExportObjectResult {
  blob: Blob;
  filename: string;
}

async function accessRequest<T>({
  operation,
  runtime,
  body = {},
}: AccessRequestInput): Promise<T> {
  const response = await fetch(
    `/api/db/v1alpha1/${encodeURIComponent(runtime.databaseWorkloadName)}/access/${operation}`,
    {
      body: JSON.stringify(withAccessBaseBody(runtime, body)),
      headers: {
        Authorization: `Bearer ${encodeURIComponent(runtime.kubeconfig.trim())}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text.trim() ||
        `Data browser access request failed with status ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

function withAccessBaseBody(
  runtime: DataBrowserHostContext,
  body: Record<string, unknown> = {}
) {
  return {
    projectId: runtime.projectUid,
    namespace: runtime.databaseWorkloadNamespace,
    ...body,
  };
}

export function listObjects({
  runtime,
  parent,
  kinds,
}: ListObjectsInput): Promise<AccessObjectsResult> {
  return accessRequest<AccessObjectsResult>({
    body: {
      ...(parent === undefined ? {} : { parent }),
      ...(kinds === undefined ? {} : { kinds }),
    },
    operation: "objects",
    runtime,
  });
}

export function getObject({
  runtime,
  ref,
}: GetObjectInput): Promise<AccessObjectResult> {
  return accessRequest<AccessObjectResult>({
    body: { ref },
    operation: "object",
    runtime,
  });
}

export function getColumns({
  runtime,
  ref,
}: GetColumnsInput): Promise<AccessColumnsResult> {
  return accessRequest<AccessColumnsResult>({
    body: { ref },
    operation: "columns",
    runtime,
  });
}

export function getRows({
  runtime,
  ref,
  pageSize,
  pageOffset,
  sort,
}: GetRowsInput): Promise<AccessRowsResult> {
  return accessRequest<AccessRowsResult>({
    body: {
      ref,
      pageSize,
      pageOffset,
      ...(sort === undefined || sort.length === 0 ? {} : { sort }),
    },
    operation: "rows",
    runtime,
  });
}

export function accessRowsToDataFlowTableData(
  result: AccessRowsResult
): DataFlowTableData {
  const columns = result.columns.map((column) => column.name);
  const columnTypes = Object.fromEntries(
    result.columns.map((column) => [column.name, column.type])
  );

  const rows = result.rows.map((row) => {
    const mapped: Record<string, string | null> = {};
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index];
      if (!column) {
        continue;
      }
      const value = row[index];
      mapped[column] = value === undefined || value === "" ? null : value;
    }
    return mapped;
  });

  return {
    columns,
    columnTypes,
    rows,
    primaryKey: result.columns.find((column) => column.isPrimary)?.name ?? null,
    foreignKeyColumns: result.columns
      .filter((column) => column.isForeignKey)
      .map((column) => column.name),
    total: result.totalCount,
    disableUpdate: true,
  };
}

function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const filenameStar = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameStar?.[1]) {
    return decodeURIComponent(filenameStar[1]);
  }

  const filename = contentDisposition.match(/filename="?([^";]+)"?/i);
  return filename?.[1] ?? null;
}

function fallbackExportFilename(
  ref: AccessObjectRef,
  format: AccessExportFormat
) {
  const rawBasename = ref.path.at(-1) || ref.kind;
  const basename =
    rawBasename.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") ||
    "export";
  return `${basename}.${format === "ndjson" ? "ndjson" : "csv"}`;
}

export async function exportObject({
  format,
  ref,
  runtime,
}: ExportObjectInput): Promise<ExportObjectResult> {
  const response = await fetch(
    `/api/db/v1alpha1/${encodeURIComponent(runtime.databaseWorkloadName)}/access/export`,
    {
      body: JSON.stringify(
        withAccessBaseBody(runtime, {
          format,
          ref,
        })
      ),
      headers: {
        Authorization: `Bearer ${encodeURIComponent(runtime.kubeconfig.trim())}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text.trim() ||
        `Data browser export request failed with status ${response.status}`
    );
  }

  return {
    blob: await response.blob(),
    filename:
      parseFilename(response.headers.get("Content-Disposition")) ??
      fallbackExportFilename(ref, format),
  };
}

export const DATA_BROWSER_EXPORT_FORMATS = ["csv", "ndjson"] as const;
