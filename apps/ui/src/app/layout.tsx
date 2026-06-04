import { Geist, JetBrains_Mono } from "next/font/google";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

import "@workspace/ui/globals.css";
import { Toaster } from "@workspace/ui/components/sonner";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { JotaiProvider } from "@/components/jotai-provider";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <JotaiProvider>
          <NuqsAdapter>
            <ThemeProvider>
              <TooltipProvider>
                <Toaster />
                <Suspense fallback={null}>{children}</Suspense>
              </TooltipProvider>
            </ThemeProvider>
          </NuqsAdapter>
        </JotaiProvider>
      </body>
    </html>
  );
}
