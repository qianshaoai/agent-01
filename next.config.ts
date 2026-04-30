import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 4.30up：pdf-parse + pdfjs-dist + mammoth 不打包，直接从 node_modules 跑，
  // 保证 pdfjs-dist 能找到自己的 worker 文件
  serverExternalPackages: ["pg", "pg-native", "pdf-parse", "pdfjs-dist", "mammoth"],
  outputFileTracingIncludes: {
    "/api/upload": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/xlsx/**/*",
      "./node_modules/jszip/**/*",
    ],
    "/api/trial/chat": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/xlsx/**/*",
      "./node_modules/jszip/**/*",
    ],
  },
};

export default nextConfig;
