import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const internalHost = process.env.TAURI_DEV_HOST || 'localhost';

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  assetPrefix: isProd ? undefined : `http://${internalHost}:3456`,
  sassOptions: {
    silenceDeprecations: ['legacy-js-api'],
  },
  // 正确的 allowedDevOrigins 配置格式
  allowedDevOrigins: isProd ? undefined : ['local-origin.dev', '*.local-origin.dev', internalHost],
};

export default nextConfig;