import { Geist, JetBrains_Mono } from "next/font/google";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

import "@workspace/ui/globals.css";
import { Toaster } from "@workspace/ui/components/sonner";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { JotaiProvider } from "@/components/jotai-provider";
import { DevTweaks } from "@/features/dev-tweaks/dev-tweaks";
import { StatusHeartbeatTweaks } from "@/features/dev-tweaks/status-heartbeat-tweaks";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const reactScanEnabled =
  process.env.NODE_ENV === "development" && process.env.REACT_SCAN === "true";

const reactScanOptionsScript = `
window.reactScan?.({
  allowInIframe: true,
  animationSpeed: "slow",
  enabled: true,
  safeArea: { bottom: 80, right: 24 },
  showFPS: true,
  showNotificationCount: true,
  showToolbar: true,
  trackUnnecessaryRenders: true,
});
`;

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
      <head>
        {reactScanEnabled ? (
          <>
            <script src="https://unpkg.com/react-scan/dist/auto.global.js" />
            <script>{reactScanOptionsScript}</script>
          </>
        ) : null}
      </head>
      <body>
        <JotaiProvider>
          <NuqsAdapter>
            <ThemeProvider>
              <TooltipProvider>
                <Toaster />
                {/* Outside the children Suspense so it works while the app
                    content is still streaming or blocked on data. */}
                <DevTweaks />
                <StatusHeartbeatTweaks />
                <Suspense fallback={null}>{children}</Suspense>
              </TooltipProvider>
            </ThemeProvider>
          </NuqsAdapter>
        </JotaiProvider>
      </body>
    </html>
  );
}
