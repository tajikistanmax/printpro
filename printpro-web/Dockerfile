# PrintPro Web (панель) — образ для локального узла
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# ВАЖНО: НЕ зашиваем NEXT_PUBLIC_API_BASE/SERVER_ORIGIN на этапе сборки.
# Они попадают в клиентский бандл навсегда и ломают LAN-автоопределение:
# касса на другой машине пошла бы в свой localhost:3000 (где API нет) вместо
# главного ПК. Адрес API определяется в рантайме по хосту браузера
# (см. printpro-web/src/lib/config.ts). Если для конкретного деплоя нужен
# фиксированный адрес — задать эти переменные при сборке снаружи (--build-arg).
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# standalone-сборка содержит свой минимальный node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3001
CMD ["node", "server.js"]
