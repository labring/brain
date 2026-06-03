import { Button } from "@data-browser/components/ui/Button";
import { Checkbox } from "@data-browser/components/ui/checkbox";
import { Input } from "@data-browser/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@data-browser/components/ui/select";
import { cn } from "@data-browser/lib/utils";
import { AppButton } from "@workspace/ui/components/app-button";
import { Plus, X } from "lucide-react";
import { useEditTable } from "./EditTableProvider";

const COLUMN_TYPES = [
  "INT",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "VARCHAR(50)",
  "VARCHAR(100)",
  "VARCHAR(255)",
  "VARCHAR(500)",
  "TEXT",
  "LONGTEXT",
  "MEDIUMTEXT",
  "BOOLEAN",
  "BIT",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "TIME",
  "DECIMAL(10,2)",
  "DECIMAL(18,4)",
  "FLOAT",
  "DOUBLE",
  "JSON",
  "BLOB",
];

/**
 * Columns tab for EditTableModal — batch editing with inline deletion marking.
 * Renders a table of columns with name, type, nullable, and a hover delete button.
 * Consumes `useEditTable()` for all state and actions.
 */
export function EditTableColumnsTab() {
  const { state, actions } = useEditTable();
  const { columns, isExecuting } = state;
  const { addColumn, updateColumn, toggleColumnDeletion } = actions;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <AppButton
          className="gap-1 text-primary"
          onClick={addColumn}
          size="sm"
          variant="quiet"
        >
          <Plus className="h-3 w-3" />
          {"Add field"}
        </AppButton>
      </div>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{"Name"}</th>
              <th className="px-3 py-2 text-left font-medium">{"Type"}</th>
              <th className="w-14 px-3 py-2 text-center font-medium">
                {"Null"}
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {columns.map((col) => (
              <tr
                className={cn(
                  "group relative hover:bg-input/30",
                  col.isNew && !col.isMarkedForDeletion && "bg-primary/5",
                  col.isMarkedForDeletion && "bg-destructive/5 opacity-60"
                )}
                key={col.id}
              >
                <td className="p-2">
                  <Input
                    className={cn(
                      "h-auto border-transparent bg-transparent px-2 py-1 shadow-none focus-visible:border-primary focus-visible:bg-background focus-visible:ring-0",
                      col.isMarkedForDeletion &&
                        "text-muted-foreground line-through"
                    )}
                    disabled={isExecuting || col.isMarkedForDeletion}
                    onChange={(e) =>
                      updateColumn(col.id, "name", e.target.value)
                    }
                    placeholder={"Column name"}
                    readOnly={!col.isNew}
                    value={col.name}
                  />
                </td>
                <td className="p-2">
                  <Select
                    disabled={isExecuting || col.isMarkedForDeletion}
                    onValueChange={(v) => updateColumn(col.id, "type", v)}
                    value={col.type}
                  >
                    <SelectTrigger
                      className={cn(
                        "w-full bg-transparent text-sm",
                        col.isMarkedForDeletion &&
                          "text-muted-foreground line-through"
                      )}
                      size="sm"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {col.type && !COLUMN_TYPES.includes(col.type) && (
                        <SelectItem value={col.type}>{col.type}</SelectItem>
                      )}
                      {COLUMN_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-2 text-center">
                  <Checkbox
                    checked={col.isNullable}
                    disabled={isExecuting || col.isMarkedForDeletion}
                    onCheckedChange={(checked) =>
                      updateColumn(col.id, "isNullable", checked === true)
                    }
                  />
                </td>
                <td className="p-1">
                  <Button
                    className={cn(
                      "opacity-0 transition-opacity group-hover:opacity-100",
                      col.isMarkedForDeletion
                        ? "text-destructive opacity-100 hover:bg-destructive/5 hover:text-destructive/80"
                        : "text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
                    )}
                    disabled={isExecuting}
                    onClick={() => toggleColumnDeletion(col)}
                    size="sm"
                    variant="ghost"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
