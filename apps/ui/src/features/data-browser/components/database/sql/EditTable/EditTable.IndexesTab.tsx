import { Button } from "@data-browser/components/ui/Button";
import { Checkbox } from "@data-browser/components/ui/checkbox";
import { Input } from "@data-browser/components/ui/Input";
import { MultiSelect } from "@data-browser/components/ui/MultiSelect";
import { cn } from "@data-browser/lib/utils";
import { AppButton } from "@workspace/ui/components/app-button";
import { Plus, X } from "lucide-react";
import { useEditTable } from "./EditTableProvider";

/**
 * Indexes tab for EditTableModal — batch editing with inline deletion marking.
 * Renders a table of indexes with name, columns (MultiSelect), unique, and a hover delete button.
 * Consumes `useEditTable()` for all state and actions.
 */
export function EditTableIndexesTab() {
  const { state, actions } = useEditTable();
  const { indexes, columnNames, isExecuting } = state;
  const { addIndex, updateIndex, toggleIndexDeletion } = actions;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <AppButton
          className="gap-1 text-primary"
          onClick={addIndex}
          size="sm"
          variant="quiet"
        >
          <Plus className="h-3 w-3" />
          {"Add index"}
        </AppButton>
      </div>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{"Name"}</th>
              <th className="px-3 py-2 text-left font-medium">{"Columns"}</th>
              <th className="w-16 px-3 py-2 text-center font-medium">
                {"Unique"}
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {indexes.length === 0 ? (
              <tr>
                <td
                  className="p-8 text-center text-muted-foreground"
                  colSpan={4}
                >
                  {"No indexes"}
                </td>
              </tr>
            ) : (
              indexes.map((idx) => (
                <tr
                  className={cn(
                    "group relative hover:bg-input/30",
                    idx.isNew && !idx.isMarkedForDeletion && "bg-primary/5",
                    idx.isMarkedForDeletion && "bg-destructive/5 opacity-60"
                  )}
                  key={idx.id}
                >
                  <td className="p-2">
                    <Input
                      className={cn(
                        "h-auto border-transparent bg-transparent px-2 py-1 shadow-none focus-visible:border-primary focus-visible:bg-background focus-visible:ring-0",
                        idx.isMarkedForDeletion &&
                          "text-muted-foreground line-through"
                      )}
                      disabled={isExecuting || idx.isMarkedForDeletion}
                      onChange={(e) =>
                        updateIndex(idx.id, "name", e.target.value)
                      }
                      placeholder={"Index name"}
                      value={idx.name}
                    />
                  </td>
                  <td className="p-2">
                    <MultiSelect
                      className={cn(
                        "w-full bg-transparent text-sm",
                        idx.isMarkedForDeletion &&
                          "text-muted-foreground line-through"
                      )}
                      disabled={isExecuting || idx.isMarkedForDeletion}
                      onChange={(newCols) =>
                        updateIndex(idx.id, "columns", newCols)
                      }
                      options={columnNames}
                      placeholder={"column1, column2"}
                      selected={idx.columns}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <Checkbox
                      checked={idx.isUnique}
                      disabled={isExecuting || idx.isMarkedForDeletion}
                      onCheckedChange={(checked) =>
                        updateIndex(idx.id, "isUnique", checked === true)
                      }
                    />
                  </td>
                  <td className="p-1">
                    <Button
                      className={cn(
                        "opacity-0 transition-opacity group-hover:opacity-100",
                        idx.isMarkedForDeletion
                          ? "text-destructive opacity-100 hover:bg-destructive/5 hover:text-destructive/80"
                          : "text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
                      )}
                      disabled={isExecuting}
                      onClick={() => toggleIndexDeletion(idx)}
                      size="sm"
                      variant="ghost"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
