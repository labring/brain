/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Overridable so a second dev instance (e.g. Claude preview) can run
  // alongside `bun dev` without fighting over the .next dev-server lock.
  distDir: process.env.NEXT_DIST_DIR || undefined,
  transpilePackages: ["@workspace/ui", "@workspace/api"],
  logging: {
    serverFunctions: false,
  },
  experimental: {
    /** Enables `unauthorized()` from `next/navigation` for server-side auth checks. */
    authInterrupts: true,
  },
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The app runs inside a Sealos desktop iframe on a same-site origin
          // (*.cloud.sealos.io), so Chromium co-hosts it with the desktop
          // shell and every other open app on ONE renderer main thread.
          // Origin-Agent-Cluster asks for an origin-keyed agent cluster,
          // which desktop Chromium backs with a dedicated process when
          // resources allow. Verify via `window.originAgentCluster`.
          { key: "Origin-Agent-Cluster", value: "?1" },
        ],
      },
    ];
  },
};

export default nextConfig;
