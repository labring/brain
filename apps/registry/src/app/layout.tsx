import { Geist, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";

import "@/styles/globals.css";
import { getRegistrySidebarSections } from "@registry/lib";
import { Toaster } from "@workspace/ui/components/sonner";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { AppShell } from "@/components/app-shell";

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
  const registrySections = getRegistrySidebarSections();

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
        <ThemeProvider>
          <TooltipProvider>
            <NuqsAdapter>
              <Suspense fallback={null}>
                <AppShell registrySections={registrySections}>
                  {children}
                </AppShell>
              </Suspense>
            </NuqsAdapter>
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
