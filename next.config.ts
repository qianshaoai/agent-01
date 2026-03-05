import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/upload": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/xlsx/**/*",
    ],
  },
};

export default nextConfig;
