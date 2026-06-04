"use client";

import { mockApConfigSnapshotRows } from "@registry/linear/components/container-history-pane/container-history-mock";
import { ContainerHistoryPane } from "@workspace/ui/components/container-history-pane/container-history-pane";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { useMemo } from "react";

const DEMO_WORKLOAD = "workload-demo-001";

export default function ContainerHistoryPanePreview() {
  const rows = useMemo(() => mockApConfigSnapshotRows(), []);

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview
        className="flex h-[min(44rem,52vh)] max-h-[min(44rem,52vh)] min-h-0 flex-col gap-4 overflow-hidden"
        maximizedClassName="h-full max-h-none min-h-0"
        showMaximize
        title="Container history — AP image versions"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <ContainerHistoryPane
            className="min-h-0 flex-1 overflow-hidden px-1"
            rows={rows}
            showSnapshotExplainerAlert
            workloadName={DEMO_WORKLOAD}
          />
          <p className="shrink-0 text-muted-foreground text-xs">
            Review opens image version metadata. Rollback remains a product
            integration point.
          </p>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
