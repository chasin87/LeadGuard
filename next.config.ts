import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["nodemailer", "playwright-core"],
};

export default nextConfig;
