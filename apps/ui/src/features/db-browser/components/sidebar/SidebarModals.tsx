import { SingleObjectExportModal } from "@db-browser/components/database/shared/SingleObjectExportModal";
import type { Alert } from "@db-browser/components/database/shared/types";
import { DbAccessAlertDialog } from "@db-browser/components/shared/DbAccessDialogs";
import type { ModalState } from "./Sidebar";
import type { TreeNodeData } from "./SidebarTree/types";

interface SidebarModalsProps {
  activeModal: ModalState | null;
  alert: Alert | null;
  closeAlert: () => void;
  closeModal: () => void;
  refreshNode: (node: TreeNodeData) => void;
}

export function SidebarModals({
  activeModal,
  alert,
  closeAlert,
  closeModal,
}: SidebarModalsProps) {
  return (
    <>
      {activeModal?.type === "export_data" && (
        <SingleObjectExportModal
          objectRef={activeModal.params.objectRef}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open
          title={activeModal.params.tableName}
        />
      )}

      {activeModal?.type === "export_collection" && (
        <SingleObjectExportModal
          objectRef={activeModal.params.objectRef}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open
          title={activeModal.params.collectionName}
        />
      )}

      {activeModal?.type === "export_redis_key" && (
        <SingleObjectExportModal
          objectRef={activeModal.params.objectRef}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open
          title={activeModal.params.keyName}
        />
      )}

      <DbAccessAlertDialog alert={alert} onClose={closeAlert} />
    </>
  );
}
