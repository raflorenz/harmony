import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-side node modules that should not be bundled
  serverExternalPackages: ['chokidar', 'liquidjs', 'js-yaml'],
};

export default nextConfig;
