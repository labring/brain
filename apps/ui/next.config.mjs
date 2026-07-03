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
};

export default nextConfig;
