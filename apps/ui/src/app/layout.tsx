import { GoogleTagManager } from "@next/third-parties/google";
import { Geist, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

import "@workspace/ui/globals.css";
import { Toaster } from "@workspace/ui/components/sonner";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { DevTweaks } from "@/features/dev-tweaks/dev-tweaks";
import { JotaiProvider } from "@/features/shell/jotai-provider";

// GTM_ID is injected by the deployment environment and must not be baked into
// a statically generated layout.
export const dynamic = "force-dynamic";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const gtmId = process.env.GTM_ID?.trim() ?? "";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={cn(
        "h-full antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
      lang="en"
      suppressHydrationWarning
    >
      <body className="h-full">
        <JotaiProvider>
          <NuqsAdapter>
            <ThemeProvider>
              <TooltipProvider>
                <Toaster />
                {/* DevTweaks mounts the dev-only tweaks panel next to the
                    app; in production it renders children untouched. */}
                <DevTweaks>
                  <Suspense fallback={null}>{children}</Suspense>
                </DevTweaks>
              </TooltipProvider>
            </ThemeProvider>
          </NuqsAdapter>
        </JotaiProvider>
        {gtmId === "" ? null : <GoogleTagManager gtmId={gtmId} />}
      </body>
    </html>
  );
}
