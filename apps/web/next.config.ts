import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@footylocal/ui", "@footylocal/core", "@footylocal/db"],
  // Workspace packages are consumed straight from TS source and use NodeNext-style
  // relative imports ("./geo/index.js") that resolve to .ts files under `tsc`'s
  // Bundler moduleResolution. Webpack doesn't do that remapping on its own, so we
  // teach it the same .js -> .ts/.tsx alias here.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
