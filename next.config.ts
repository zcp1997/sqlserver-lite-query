import type { NextConfig } from "next";

import MonacoWebpackPlugin from "monaco-editor-webpack-plugin";

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

  webpack: (config, { isServer }) => {
    // Monaco Editor uses a CSS file, and Next.js needs to be told how to handle it.
    // However, with modern Next.js (App Router or newer Pages Router versions),
    // CSS imports from node_modules are often handled automatically.
    // If you encounter CSS issues, you might need a specific loader rule.

    if (!isServer) {
      config.plugins.push(
        new MonacoWebpackPlugin({
          languages: ['sql', /* add other languages you need here, e.g., 'javascript', 'typescript', 'json' */],
          filename: 'static/[name].worker.js', // Output to static directory
          publicPath: '_next', // Important: makes it compatible with Next.js's static file serving
        })
      );
    }

    // Optional: If you see issues with 'fs' module not found in client-side bundles
    // This can happen if some Monaco-related code (or a library it uses)
    // incorrectly tries to use 'fs' in the browser.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };


    return config;
  },
};

export default nextConfig;