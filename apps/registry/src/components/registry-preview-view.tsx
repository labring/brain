"use client";

import {
  getRegistryPreviewLoaderByKey,
  type RegistryPreviewLoader,
} from "@registry/preview-registry";
import dynamic from "next/dynamic";
import { useState } from "react";

import { useRegistryPreviewVariant } from "@/hooks/use-registry-preview-variant";

function PreviewLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-muted-foreground text-sm">Loading…</p>
    </div>
  );
}

function RegistryPreviewContent({ loader }: { loader: RegistryPreviewLoader }) {
  // dynamic() mints a new component, so hold it in state for a stable
  // identity. The parent keys this component by preview + variant; a loader
  // change arrives as a remount that re-runs the initializer.
  const [Cmp] = useState(() => dynamic(loader, { loading: PreviewLoading }));

  return <Cmp />;
}

export default function RegistryPreviewView({
  previewKey,
}: {
  previewKey: string;
}) {
  const { effectiveVariantId } = useRegistryPreviewVariant(previewKey);

  const loader =
    effectiveVariantId == null
      ? undefined
      : getRegistryPreviewLoaderByKey(previewKey, effectiveVariantId);

  if (!loader) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">Preview not found.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col p-4">
      <div className="flex min-h-0 flex-1 flex-col">
        <RegistryPreviewContent
          key={`${previewKey}:${effectiveVariantId}`}
          loader={loader}
        />
      </div>
    </div>
  );
}
