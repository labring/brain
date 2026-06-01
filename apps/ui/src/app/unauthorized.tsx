import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import Link from "next/link";

/** UI for Next.js `unauthorized()` when workspace auth is missing. */
export default function Unauthorized() {
  return (
    <main className="flex h-screen min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-semibold text-2xl text-foreground">
        Sign in required
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        Log in with your workspace before you can use this app.
      </p>
      <Link
        className={cn(buttonVariants({ size: "default", variant: "default" }))}
        href="/"
      >
        Refresh
      </Link>
    </main>
  );
}
