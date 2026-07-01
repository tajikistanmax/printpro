import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка для Docker-образа локального узла
  output: "standalone",

  // Разрешаем доступ к dev-серверу из локальной сети (по IP), напр. с планшета
  // кассы: 192.168.0.118:3001. Без этого Next 15+/16 блокирует cross-origin
  // dev-запросы (RSC/HMR) → страница висит на «Загрузка…».
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
};

export default nextConfig;
