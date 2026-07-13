import type { FindBarModel } from "@data-browser/components/database/shared/FindBar";
import { cn } from "@workspace/ui/lib/utils";
import { FileJson } from "lucide-react";
import { useMemo } from "react";

const LEADING_OBJECT_BRACE_PATTERN = /^\{\n/;
const TRAILING_OBJECT_BRACE_PATTERN = /\n\}$/;

function buildDocumentRowKey(pageOffset: number, sourceRowIndex: number) {
  return `existing-${pageOffset + sourceRowIndex}`;
}

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
        doc,
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
      {renderedDocs.map((item) => {
        // FindBar matching only applies to existing documents (not pending inserts)
        const hasMatch = find.state.total
          ? find.state.matches.some(
              (match) => match.rowIndex === item.sourceRowIndex
            )
          : false;
        const hasCurrentMatch = find.state.total
          ? find.state.matches[find.state.currentMatchIndex]?.rowIndex ===
            item.sourceRowIndex
          : false;

        return (
          <div
            className={cn(
              "group relative rounded-xl p-4 transition-colors duration-200",
              hasCurrentMatch && "border border-input bg-input shadow-sm",
              !hasCurrentMatch &&
                hasMatch &&
                "border border-input/30 bg-input/30",
              !(hasCurrentMatch || hasMatch) &&
                "border border-border/50 bg-background hover:bg-input/30 hover:shadow-sm"
            )}
            data-find-current={hasCurrentMatch ? "true" : undefined}
            data-qa-module="mongodb"
            data-qa-object="document"
            data-qa-resource-id={item.rowKey}
            data-qa-resource-type="document"
            data-qa-state="ready"
            data-testid="mongodb.collection.document-card"
            key={item.rowKey}
          >
            <div className="relative">
              <pre className="overflow-x-auto font-mono text-foreground/80 text-sm">
                {JSON.stringify(item.doc, null, 2)
                  .replace(LEADING_OBJECT_BRACE_PATTERN, "")
                  .replace(TRAILING_OBJECT_BRACE_PATTERN, "")}
              </pre>
            </div>
          </div>
        );
      })}
    </>
  );
}
