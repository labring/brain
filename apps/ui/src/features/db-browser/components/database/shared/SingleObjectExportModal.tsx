import {
  type AccessExportFormat,
  DATA_BROWSER_EXPORT_FORMATS,
  exportObject,
} from "@db-browser/api/access-adapter";
import type { AccessObjectRef } from "@db-browser/api/access-types";
import { useDataBrowserRuntime } from "@db-browser/runtime";
import { downloadBlob } from "@db-browser/utils/export-utils";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { cn } from "@workspace/ui/lib/utils";
import { Download, FileText } from "lucide-react";
import { useState } from "react";

interface SingleObjectExportModalProps {
  objectRef: AccessObjectRef;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title?: string;
}

const FORMAT_LABELS: Record<AccessExportFormat, string> = {
  csv: "CSV",
  ndjson: "NDJSON",
};

export function SingleObjectExportModal({
  objectRef,
  onOpenChange,
  open,
  title,
}: SingleObjectExportModalProps) {
  const runtime = useDataBrowserRuntime();
  const [format, setFormat] = useState<AccessExportFormat>("csv");
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setIsExporting(true);
    setError(null);

    try {
      const result = await exportObject({ format, ref: objectRef, runtime });
      downloadBlob(result.blob, result.filename);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        if (isExporting && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <AppDialog.Content>
        <AppDialog.Header>
          <AppDialog.Title>{title ?? "Export"}</AppDialog.Title>
        </AppDialog.Header>

        <AppDialog.Body>
          <div className="grid grid-cols-2 gap-2">
            {DATA_BROWSER_EXPORT_FORMATS.map((option) => (
              <button
                className={cn(
                  "inline-flex h-9 items-center justify-start gap-2 rounded-lg border border-border px-3 font-medium text-sm/5 outline-none transition-colors",
                  format === option
                    ? "bg-white/10 text-zinc-50"
                    : "bg-white/[0.045] text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
                )}
                disabled={isExporting}
                key={option}
                onClick={() => setFormat(option)}
                type="button"
              >
                <FileText className="h-4 w-4" />
                {FORMAT_LABELS[option]}
              </button>
            ))}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </AppDialog.Body>

        <AppDialog.Footer>
          <AppDialog.Cancel disabled={isExporting}>Cancel</AppDialog.Cancel>
          <AppDialog.Action
            loading={isExporting}
            loadingLabel="Exporting"
            onClick={handleExport}
            type="button"
          >
            <Download className="h-4 w-4" />
            {"Export"}
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
