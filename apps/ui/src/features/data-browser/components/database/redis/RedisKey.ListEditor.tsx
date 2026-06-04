import { Button } from "@data-browser/components/ui/Button";
import { useModalForm } from "@data-browser/components/ui/ModalForm";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@data-browser/components/ui/tooltip";
import { AppButton } from "@workspace/ui/components/app-button";
import { Plus, Trash2 } from "lucide-react";
import { useRedisKeyCtx } from "./RedisKeyProvider";

/** Create-only editor for Redis list values. */
export function RedisKeyListEditor() {
  const { draft, setListItems } = useRedisKeyCtx();
  const { state } = useModalForm();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="font-medium text-foreground text-sm">{"Value"}</label>
        <AppButton
          className="h-7 gap-1 px-2 text-primary text-xs hover:text-primary"
          disabled={state.isSubmitting}
          onClick={() => setListItems([...draft.listItems, { value: "" }])}
          size="sm"
          type="button"
          variant="quiet"
        >
          <Plus className="h-3 w-3" />
          {"Add item"}
        </AppButton>
      </div>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{"List item"}</th>
              <th className="w-10 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {draft.listItems.map((item, index) => (
              <tr className="group hover:bg-input/30" key={index}>
                <td className="p-2">
                  <input
                    className="w-full rounded border-transparent bg-transparent px-2 py-1 font-mono text-sm outline-none focus:border-primary focus:bg-background disabled:opacity-50"
                    disabled={state.isSubmitting}
                    onChange={(e) => {
                      const next = [...draft.listItems];
                      next[index] = { value: e.target.value };
                      setListItems(next);
                    }}
                    placeholder={"List item"}
                    type="text"
                    value={item.value}
                  />
                </td>
                <td className="p-2 text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className={`text-muted-foreground transition-opacity hover:text-destructive ${draft.listItems.length > 1 ? "opacity-0 group-hover:opacity-100" : "invisible"}`}
                        disabled={state.isSubmitting}
                        onClick={() =>
                          setListItems(
                            draft.listItems.filter((_, i) => i !== index)
                          )
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{"Remove item"}</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
