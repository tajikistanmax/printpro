import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка для Docker-образа локального узла
  output: "standalone",
};

export default nextConfig;
