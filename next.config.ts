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
      // 5.15up · pdfjs-dist 依赖的原生模块，Node 环境靠它 polyfill DOMMatrix/ImageData/Path2D。
      // 它是 optionalDependency + 原生 .node，nft 静态追踪抓不到，必须显式纳入，
      // 否则 standalone 构建缺它 → 线上 getText() 报 "DOMMatrix is not defined"。
      "./node_modules/@napi-rs/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/xlsx/**/*",
      "./node_modules/jszip/**/*",
    ],
    "/api/trial/chat": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/xlsx/**/*",
      "./node_modules/jszip/**/*",
    ],
  },
};

export default nextConfig;
