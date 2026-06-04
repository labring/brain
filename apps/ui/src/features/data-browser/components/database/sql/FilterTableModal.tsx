import { Button } from "@data-browser/components/ui/Button";
import { Checkbox } from "@data-browser/components/ui/checkbox";
import { Dialog, DialogContent } from "@data-browser/components/ui/dialog";
import { Input } from "@data-browser/components/ui/Input";
import { ModalForm } from "@data-browser/components/ui/ModalForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@data-browser/components/ui/select";
import { AppButton } from "@workspace/ui/components/app-button";
import { Filter, Plus, Trash2 } from "lucide-react";
import { createContext, type ReactNode, use, useState } from "react";
import type { FilterCondition } from "./TableView/types";

// ---------------------------------------------------------------------------
// Internal context
// ---------------------------------------------------------------------------

interface FilterTableContextValue {
  addCondition: () => void;
  columns: string[];
  conditions: FilterCondition[];
  removeCondition: (id: string) => void;
  selectedColumns: Set<string>;
  toggleAllColumns: () => void;
  toggleColumn: (col: string) => void;
  updateCondition: (
    id: string,
    field: keyof FilterCondition,
    value: string
  ) => void;
}

const FilterTableCtx = createContext<FilterTableContextValue | null>(null);

function useFilterTable(): FilterTableContextValue {
  const ctx = use(FilterTableCtx);
  if (!ctx) {
    throw new Error("useFilterTable must be used within FilterTableProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface FilterTableProviderProps {
  children: ReactNode;
  columns: string[];
  initialConditions: FilterCondition[] | undefined;
  initialSelectedColumns: string[] | undefined;
}

function FilterTableProvider({
  columns,
  initialSelectedColumns,
  initialConditions,
  children,
}: FilterTableProviderProps) {
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(() => {
    if (initialSelectedColumns && initialSelectedColumns.length > 0) {
      return new Set(initialSelectedColumns);
    }
    return new Set(columns);
  });
  const [conditions, setConditions] = useState<FilterCondition[]>(() => {
    if (initialConditions && initialConditions.length > 0) {
      return initialConditions;
    }
    return [
      {
        id: Math.random().toString(36).substring(7),
        column: columns[0] || "",
        operator: "=",
        value: "",
      },
    ];
  });

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  };

  const toggleAllColumns = () => {
    setSelectedColumns((prev) =>
      prev.size === columns.length ? new Set() : new Set(columns)
    );
  };

  const addCondition = () => {
    setConditions((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        column: columns[0] || "",
        operator: "=",
        value: "",
      },
    ]);
  };

  const removeCondition = (id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const updateCondition = (
    id: string,
    field: keyof FilterCondition,
    value: string
  ) => {
    setConditions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  return (
    <FilterTableCtx
      value={{
        columns,
        selectedColumns,
        conditions,
        toggleColumn,
        toggleAllColumns,
        addCondition,
        removeCondition,
        updateCondition,
      }}
    >
      {children}
    </FilterTableCtx>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ColumnSelector() {
  const { columns, selectedColumns, toggleColumn, toggleAllColumns } =
    useFilterTable();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground text-sm">
          {"Visible columns"}
        </h3>
        <AppButton
          className="h-6 p-0 text-blue-500 text-sm"
          onClick={toggleAllColumns}
          size="sm"
          variant="quiet"
        >
          {selectedColumns.size === columns.length
            ? "Deselect all"
            : "Select all"}
        </AppButton>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {columns.map((col) => (
          <div
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${selectedColumns.has(col) ? "border-transparent bg-blue-500/10 text-foreground" : "border-input bg-background text-foreground hover:bg-muted/30"}`}
            key={col}
            onClick={() => toggleColumn(col)}
          >
            <Checkbox
              checked={selectedColumns.has(col)}
              className="pointer-events-none"
              tabIndex={-1}
            />
            <span className="truncate text-sm" title={col}>
              {col}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConditionList() {
  const {
    columns,
    conditions,
    addCondition,
    removeCondition,
    updateCondition,
  } = useFilterTable();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground text-sm">{"Conditions"}</h3>
        <AppButton
          className="h-9 gap-2"
          onClick={addCondition}
          size="sm"
          variant="secondary"
        >
          <Plus className="h-4 w-4" />
          {"Add condition"}
        </AppButton>
      </div>

      {conditions.length > 0 && (
        <div className="flex flex-col gap-2">
          {conditions.map((condition) => (
            <div className="flex items-center gap-2" key={condition.id}>
              <Select
                onValueChange={(v) =>
                  updateCondition(condition.id, "column", v)
                }
                value={condition.column}
              >
                <SelectTrigger className="h-9 min-w-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((col) => (
                    <SelectItem key={col} value={col}>
                      {col}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                onValueChange={(v) =>
                  updateCondition(condition.id, "operator", v)
                }
                value={condition.operator}
              >
                <SelectTrigger className="h-9 w-20 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="=">=</SelectItem>
                  <SelectItem value="!=">!=</SelectItem>
                  <SelectItem value=">">&gt;</SelectItem>
                  <SelectItem value=">=">&gt;=</SelectItem>
                  <SelectItem value="<">&lt;</SelectItem>
                  <SelectItem value="<=">&lt;=</SelectItem>
                  <SelectItem value="LIKE">LIKE</SelectItem>
                  <SelectItem value="NOT LIKE">NOT LIKE</SelectItem>
                  <SelectItem value="IN">IN</SelectItem>
                  <SelectItem value="IS NULL">IS NULL</SelectItem>
                  <SelectItem value="IS NOT NULL">IS NOT NULL</SelectItem>
                </SelectContent>
              </Select>

              <Input
                className="h-9 flex-1"
                disabled={["IS NULL", "IS NOT NULL"].includes(
                  condition.operator
                )}
                onChange={(e) =>
                  updateCondition(condition.id, "value", e.target.value)
                }
                placeholder={"Value"}
                value={condition.value}
              />

              <Button
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeCondition(condition.id)}
                size="icon"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApplyButton({
  onApply,
  onClose,
}: {
  onApply: (cols: string[], conditions: FilterCondition[]) => void;
  onClose: () => void;
}) {
  const { selectedColumns, conditions } = useFilterTable();

  const handleApply = () => {
    onApply(Array.from(selectedColumns), conditions);
    onClose();
  };

  return (
    <AppButton onClick={handleApply} variant="secondary">
      {"Apply filter"}
    </AppButton>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface FilterTableModalProps {
  columns: string[];
  initialConditions?: FilterCondition[];
  initialSelectedColumns?: string[];
  onApply: (selectedColumns: string[], conditions: FilterCondition[]) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function FilterTableModal({
  open,
  onOpenChange,
  columns,
  onApply,
  initialSelectedColumns,
  initialConditions,
}: FilterTableModalProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[85vh] max-w-2xl flex-col"
        showCloseButton={false}
      >
        <ModalForm.Provider meta={{ title: "Filter table", icon: Filter }}>
          <FilterTableProvider
            columns={columns}
            initialConditions={initialConditions}
            initialSelectedColumns={initialSelectedColumns}
          >
            <ModalForm.Header />
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
              <ColumnSelector />
              <ConditionList />
            </div>
            <ModalForm.Footer>
              <ModalForm.CancelButton />
              <ApplyButton
                onApply={onApply}
                onClose={() => onOpenChange(false)}
              />
            </ModalForm.Footer>
          </FilterTableProvider>
        </ModalForm.Provider>
      </DialogContent>
    </Dialog>
  );
}
