/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Overridable so a second dev instance (e.g. Claude preview) can run
  // alongside `bun dev` without fighting over the .next dev-server lock.
  distDir: process.env.NEXT_DIST_DIR || undefined,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatar.vercel.sh",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "github.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
