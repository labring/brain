import { Button } from "@data-browser/components/ui/Button";
import { Dialog, DialogContent } from "@data-browser/components/ui/dialog";
import { Input } from "@data-browser/components/ui/Input";
import { ModalForm, useModalForm } from "@data-browser/components/ui/ModalForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@data-browser/components/ui/select";
import { AppButton } from "@workspace/ui/components/app-button";
import { Plus, Trash2 } from "lucide-react";
import {
  FilterCollectionProvider,
  useFilterCollectionCtx,
} from "./FilterCollectionProvider";
import type {
  FlatMongoFilter,
  MongoFilterOperator,
} from "./filter-collection.types";

interface FilterCollectionModalProps {
  fields: string[];
  initialFilter?: FlatMongoFilter;
  onApply: (filter: FlatMongoFilter) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const OPERATOR_OPTIONS: Array<{ value: MongoFilterOperator; label: string }> = [
  { value: "$eq", label: "equals" },
  { value: "$ne", label: "not equal" },
  { value: "$regex", label: "matches regex" },
  { value: "$gt", label: "greater than" },
  { value: "$lt", label: "less than" },
  { value: "$gte", label: "greater than or equal" },
  { value: "$lte", label: "less than or equal" },
  { value: "$in", label: "in list" },
];

/** Modal for building flat MongoDB collection filters. */
export function FilterCollectionModal({
  open,
  onOpenChange,
  onApply,
  fields,
  initialFilter,
}: FilterCollectionModalProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[85vh] max-w-2xl flex-col"
        showCloseButton={false}
      >
        <FilterCollectionProvider
          fields={fields}
          initialFilter={initialFilter}
          onApply={onApply}
          onOpenChange={onOpenChange}
          open={open}
        >
          <ModalForm.Header />
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            <FilterConditionList />
            <FilterModalAlert />
          </div>
          <FilterCollectionFooter />
        </FilterCollectionProvider>
      </DialogContent>
    </Dialog>
  );
}

function FilterConditionList() {
  const { conditions, fields, addCondition, removeCondition, updateCondition } =
    useFilterCollectionCtx();
  const { state } = useModalForm();
  const usedFields = new Set(
    conditions.map((condition) => condition.field.trim()).filter(Boolean)
  );
  const canAddCondition = fields.some((field) => !usedFields.has(field));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground text-sm">{"Conditions"}</h3>
        <AppButton
          className="h-9 gap-2"
          disabled={state.isSubmitting || !canAddCondition}
          onClick={addCondition}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Plus className="h-4 w-4" />
          {"Add condition"}
        </AppButton>
      </div>

      {conditions.length > 0 && (
        <div className="flex flex-col gap-2">
          {conditions.map((condition) => {
            const fieldOptions = fields.filter(
              (field) => field === condition.field || !usedFields.has(field)
            );

            return (
              <div className="flex items-center gap-2" key={condition.id}>
                <Select
                  disabled={state.isSubmitting}
                  onValueChange={(value) =>
                    updateCondition(condition.id, { field: value })
                  }
                  value={condition.field}
                >
                  <SelectTrigger className="h-9 min-w-50">
                    <SelectValue placeholder={"Select field"} />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldOptions.map((field) => (
                      <SelectItem key={field} value={field}>
                        {field}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  disabled={state.isSubmitting}
                  onValueChange={(value) =>
                    updateCondition(condition.id, {
                      operator: value as MongoFilterOperator,
                    })
                  }
                  value={condition.operator}
                >
                  <SelectTrigger className="h-9 w-20 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATOR_OPTIONS.map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  className="h-9 flex-1"
                  disabled={state.isSubmitting}
                  onChange={(event) =>
                    updateCondition(condition.id, { value: event.target.value })
                  }
                  placeholder={
                    condition.operator === "$in"
                      ? "value1, value2, value3"
                      : "Value"
                  }
                  value={condition.value}
                />

                <Button
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={state.isSubmitting}
                  onClick={() => removeCondition(condition.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterModalAlert() {
  const { state } = useModalForm();
  if (!state.alert) {
    return null;
  }
  return <ModalForm.Alert />;
}

function FilterCollectionFooter() {
  const { state, actions } = useModalForm();

  return (
    <ModalForm.Footer>
      <ModalForm.CancelButton />
      <AppButton
        disabled={state.isSubmitting}
        onClick={actions.submit}
        type="button"
        variant="secondary"
      >
        {"Apply filter"}
      </AppButton>
    </ModalForm.Footer>
  );
}
