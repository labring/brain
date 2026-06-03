import { Dialog, DialogContent } from "@data-browser/components/ui/dialog";
import { ModalForm } from "@data-browser/components/ui/ModalForm";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@data-browser/components/ui/tabs";
import { AppButton } from "@workspace/ui/components/app-button";
import { Key, Link as LinkIcon, Loader2, Table } from "lucide-react";
import { EditTableColumnsTab } from "./EditTable.ColumnsTab";
import { EditTableForeignKeysTab } from "./EditTable.ForeignKeysTab";
import { EditTableIndexesTab } from "./EditTable.IndexesTab";
import { EditTableProvider, useEditTable } from "./EditTableProvider";

// ---------------------------------------------------------------------------
// Internal composition component
// ---------------------------------------------------------------------------

/** Renders the tabbed content area, consuming EditTable context. */
function EditTableContent() {
  const { state, actions } = useEditTable();

  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={(v) => actions.setActiveTab(v as typeof state.activeTab)}
      value={state.activeTab}
    >
      <TabsList className="w-full shrink-0 justify-start px-6" variant="line">
        <TabsTrigger value="fields">
          <Table />
          {"Fields"} ({state.columns.length})
        </TabsTrigger>
        <TabsTrigger value="indexes">
          <Key />
          {"Indexes"} ({state.indexes.length})
        </TabsTrigger>
        <TabsTrigger value="foreignKeys">
          <LinkIcon />
          {"Foreign keys"} ({state.foreignKeys.length})
        </TabsTrigger>
      </TabsList>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
        {state.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <TabsContent value="fields">
              <EditTableColumnsTab />
            </TabsContent>
            <TabsContent value="indexes">
              <EditTableIndexesTab />
            </TabsContent>
            <TabsContent value="foreignKeys">
              <EditTableForeignKeysTab />
            </TabsContent>
          </>
        )}
      </div>
    </Tabs>
  );
}

/** Footer with Apply Changes and Close buttons. */
function EditTableFooter({ onClose }: { onClose: () => void }) {
  const { state, actions } = useEditTable();
  const { pendingChangeCount, isExecuting } = state;

  return (
    <ModalForm.Footer className="shrink-0 border-t bg-muted/5 px-6 py-4">
      <AppButton disabled={isExecuting} onClick={onClose} variant="quiet">
        {"Close"}
      </AppButton>
      <AppButton
        disabled={isExecuting || pendingChangeCount === 0}
        onClick={actions.applyAllChanges}
        variant="secondary"
      >
        {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {"Apply changes"}
        {pendingChangeCount > 0 && ` (${pendingChangeCount})`}
      </AppButton>
    </ModalForm.Footer>
  );
}

// ---------------------------------------------------------------------------
// Exported modal
// ---------------------------------------------------------------------------

interface EditTableModalProps {
  databaseName: string;
  dbServiceKey: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  schema?: string;
  tableName: string;
}

/**
 * Modal for editing an existing SQL table's columns, indexes, and foreign keys.
 * Calls `onSuccess` when closed so the caller can refresh its schema view.
 */
export function EditTableModal({
  open,
  onOpenChange,
  dbServiceKey,
  databaseName,
  tableName,
  schema,
  onSuccess,
}: EditTableModalProps) {
  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      onSuccess?.();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog onOpenChange={handleClose} open={open}>
      <DialogContent className="flex max-h-[90vh] min-h-[50vh] flex-col p-0 sm:max-w-5xl">
        <EditTableProvider
          databaseName={databaseName}
          dbServiceKey={dbServiceKey}
          schema={schema}
          tableName={tableName}
        >
          <div className="shrink-0 px-6 pt-6">
            <ModalForm.Header />
          </div>
          <EditTableContent />
          <ModalForm.Alert className="mx-6 shrink-0" />
          <EditTableFooter onClose={() => handleClose(false)} />
        </EditTableProvider>
      </DialogContent>
    </Dialog>
  );
}
