import {
  type FindBarModel,
  type FindHighlight,
  findRowHighlight,
} from "@db-browser/components/database/shared/FindBar";
import { cn } from "@workspace/ui/lib/utils";
import { FileJson } from "lucide-react";
import { memo, useMemo } from "react";

const LEADING_OBJECT_BRACE_PATTERN = /^\{\n/;
const TRAILING_OBJECT_BRACE_PATTERN = /\n\}$/;

function buildDocumentRowKey(pageOffset: number, sourceRowIndex: number) {
  return `existing-${pageOffset + sourceRowIndex}`;
}

function formatDocument(document: Record<string, unknown>) {
  return JSON.stringify(document, null, 2)
    .replace(LEADING_OBJECT_BRACE_PATTERN, "")
    .replace(TRAILING_OBJECT_BRACE_PATTERN, "");
}

const DocumentCard = memo(function DocumentCard({
  formattedDocument,
  highlight,
  rowKey,
  targetId,
}: {
  formattedDocument: string;
  highlight: FindHighlight;
  rowKey: string;
  targetId: string;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-xl p-4 transition-colors duration-200",
        highlight === "current" && "border border-input bg-input shadow-sm",
        highlight === "match" && "border border-input/30 bg-input/30",
        !highlight &&
          "border border-border/50 bg-background hover:bg-input/30 hover:shadow-sm"
      )}
      data-find-current={highlight === "current" ? "true" : undefined}
      data-qa-module="mongodb"
      data-qa-object="document"
      data-qa-resource-id={rowKey}
      data-qa-resource-type="document"
      data-qa-state="ready"
      data-testid="mongodb.collection.document-card"
      id={targetId}
    >
      <div className="relative">
        <pre className="overflow-x-auto font-mono text-foreground/80 text-sm">
          {formattedDocument}
        </pre>
      </div>
    </div>
  );
});

/** List of MongoDB document cards. */
export function CollectionViewDocumentList({
  currentPage,
  documents,
  find,
  pageSize,
}: {
  currentPage: number;
  documents: Record<string, unknown>[];
  find: FindBarModel;
  pageSize: number;
}) {
  const pageOffset = (currentPage - 1) * pageSize;

  const renderedDocs = useMemo(() => {
    return documents.map((doc, sourceRowIndex) => {
      return {
        formattedDocument: formatDocument(doc),
        rowKey: buildDocumentRowKey(pageOffset, sourceRowIndex),
        sourceRowIndex,
      };
    });
  }, [documents, pageOffset]);

  if (documents.length === 0) {
    return (
      <div
        className="py-12 text-center"
        data-qa-module="mongodb"
        data-qa-object="document-list"
        data-qa-state="empty"
        data-testid="mongodb.collection.document-list-empty"
      >
        <FileJson className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-sm">{"No documents found"}</p>
      </div>
    );
  }

  return (
    <>
      {renderedDocs.map((item) => (
        <DocumentCard
          formattedDocument={item.formattedDocument}
          highlight={findRowHighlight(
            find.state.highlightIndex,
            find.state.currentMatch,
            item.sourceRowIndex
          )}
          key={item.rowKey}
          rowKey={item.rowKey}
          targetId={find.meta.getTargetId(item.sourceRowIndex, "")}
        />
      ))}
    </>
  );
}
