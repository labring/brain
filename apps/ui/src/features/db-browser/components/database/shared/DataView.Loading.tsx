import { Loader2 } from "lucide-react";

/** Centered loading spinner for data views. */
export function DataViewLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
