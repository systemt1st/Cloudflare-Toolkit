const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  // 避免 `next dev` 与 `next build` 产物互相覆盖导致 `.next` 不一致
  // - dev 默认写入 `.next-dev`
  // - build/start 默认写入 `.next`
  distDir:
    process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  async rewrites() {
    const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
    const apiBase = (raw || "http://localhost:8000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
};

module.exports = withNextIntl(nextConfig);
