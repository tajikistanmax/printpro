import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка для Docker-образа локального узла
  output: "standalone",

  // Разрешаем доступ к dev-серверу из локальной сети (по IP), напр. с планшета
  // кассы: 192.168.0.118:3001. Без этого Next 15+/16 блокирует cross-origin
  // dev-запросы (RSC/HMR) → страница висит на «Загрузка…».
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],

  // Базовые security-заголовки для всех ответов панели.
  // Жёсткий Content-Security-Policy намеренно НЕ добавляем: API живёт на
  // отдельном домене (NEXT_PUBLIC_API_BASE), фронт грузит картинки/файлы с
  // /uploads бэкенда — жёсткий CSP легко сломает эти запросы. Осторожность
  // важнее полноты.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // HTTPS обязателен для всех поддоменов (2 года)
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // Панель не должна встраиваться в чужой iframe — защита от clickjacking
          { key: "X-Frame-Options", value: "DENY" },
          // Запрещаем браузеру угадывать Content-Type (защита от MIME-sniffing)
          { key: "X-Content-Type-Options", value: "nosniff" },
          // При переходе на чужой сайт передаём только origin, не полный путь
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Камера/микрофон/геолокация в панели не используются — отключаем
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
