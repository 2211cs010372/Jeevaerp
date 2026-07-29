import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Build output directory. Defaults to .next; override with NEXT_DIST_DIR when
   * a second server has to run against the same checkout (a preview alongside
   * the dev server you already have up). Two Next processes sharing one .next
   * corrupt each other's webpack cache.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
