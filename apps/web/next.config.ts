import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@footylocal/ui", "@footylocal/core", "@footylocal/db"],
};

export default nextConfig;
