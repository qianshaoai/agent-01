import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "pg-native"],
  outputFileTracingIncludes: {
    "/api/upload": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/xlsx/**/*",
    ],
  },
};

export default nextConfig;
