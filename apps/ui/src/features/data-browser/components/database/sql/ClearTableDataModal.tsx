import { Dialog, DialogContent } from "@data-browser/components/ui/dialog";
import { ModalForm, useModalForm } from "@data-browser/components/ui/ModalForm";
import {
  RadioGroup,
  RadioGroupItem,
} from "@data-browser/components/ui/radio-group";
import { cn } from "@data-browser/lib/utils";
import { useDbAccessReadOnlyActions } from "@data-browser/state/db-access-session";
import { Eraser } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ClearTableDataCtxValue {
  mode: "truncate" | "delete";
  setMode: (v: "truncate" | "delete") => void;
  tableName: string;
}

const ClearTableDataCtx = createContext<ClearTableDataCtxValue | null>(null);

/** Hook to access ClearTableData domain context. Throws outside provider. */
function useClearTableDataCtx(): ClearTableDataCtxValue {
  const ctx = use(ClearTableDataCtx);
  if (!ctx) {
    throw new Error(
      "useClearTableDataCtx must be used within ClearTableDataProvider"
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Owns business logic for clearing all data from a SQL table. */
function ClearTableDataProvider({
  databaseName,
  schema,
  tableName,
  onSuccess,
  children,
}: {
  databaseName: string;
  schema?: string;
  tableName: string;
  onSuccess?: () => void;
  children: ReactNode;
}) {
  const { clearTableData } = useDbAccessReadOnlyActions();
  const [mode, setMode] = useState<"truncate" | "delete">("truncate");

  const handleSubmit = useCallback(async () => {
    const result = await clearTableData(databaseName, schema, tableName, mode);
    if (result.success) {
      onSuccess?.();
    } else {
      throw new Error(result.message ?? "Unknown error");
    }
  }, [databaseName, schema, tableName, mode, clearTableData, onSuccess]);

  return (
    <ClearTableDataCtx value={{ mode, setMode, tableName }}>
      <ModalForm.Provider
        meta={{
          title: "Clear table data",
          icon: Eraser,
          isDestructive: true,
        }}
        onSubmit={handleSubmit}
      >
        {children}
      </ModalForm.Provider>
    </ClearTableDataCtx>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

/** Warning banner about data loss. */
function ClearTableDataWarning() {
  const { tableName } = useClearTableDataCtx();

  return (
    <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-4 text-sm">
      <p className="text-destructive">
        {`All data in "${tableName}" will be removed.`}
      </p>
    </div>
  );
}

/** Radio selector for TRUNCATE vs DELETE mode. */
function ClearTableDataModeSelector() {
  const { mode, setMode } = useClearTableDataCtx();
  const { state } = useModalForm();

  return (
    <div className="flex flex-col gap-2">
      <label className="font-medium text-foreground text-sm">
        {"Clear mode"}
      </label>
      <RadioGroup
        disabled={state.isSubmitting}
        onValueChange={(v) => setMode(v as typeof mode)}
        value={mode}
      >
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors",
            mode === "truncate"
              ? "border-transparent bg-blue-500/10"
              : "border-input bg-background hover:bg-muted/30"
          )}
        >
          <RadioGroupItem className="mt-0.5" value="truncate" />
          <div>
            <div className="font-medium text-sm">{"Fast truncate"}</div>
            <div className="text-muted-foreground text-xs">
              {"Use TRUNCATE for a faster operation when supported."}
            </div>
          </div>
        </label>
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors",
            mode === "delete"
              ? "border-transparent bg-blue-500/10"
              : "border-input bg-background hover:bg-muted/30"
          )}
        >
          <RadioGroupItem className="mt-0.5" value="delete" />
          <div>
            <div className="font-medium text-sm">{"Safe delete"}</div>
            <div className="text-muted-foreground text-xs">
              {"Use DELETE so constraints and triggers are respected."}
            </div>
          </div>
        </label>
      </RadioGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ClearTableDataModalProps {
  databaseName: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  schema?: string;
  tableName: string;
}

/** Modal for clearing all data from a SQL table (TRUNCATE or DELETE). */
export function ClearTableDataModal({
  open,
  onOpenChange,
  databaseName,
  schema,
  tableName,
  onSuccess,
}: ClearTableDataModalProps) {
  const handleSuccess = useCallback(() => {
    onSuccess?.();
    onOpenChange(false);
  }, [onSuccess, onOpenChange]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <ClearTableDataProvider
          databaseName={databaseName}
          onSuccess={handleSuccess}
          schema={schema}
          tableName={tableName}
        >
          <ModalForm.Header />
          <ClearTableDataWarning />
          <ClearTableDataModeSelector />
          <ModalForm.Alert />
          <ModalForm.Footer>
            <ModalForm.CancelButton />
            <ModalForm.SubmitButton label={"Clear table"} />
          </ModalForm.Footer>
        </ClearTableDataProvider>
      </DialogContent>
    </Dialog>
  );
}
