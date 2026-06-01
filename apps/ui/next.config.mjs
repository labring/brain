/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
