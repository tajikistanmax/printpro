# PrintPro Web (панель) — образ для локального узла
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# По умолчанию панель обращается к локальному API на этом же компьютере
ENV NEXT_PUBLIC_API_BASE=http://localhost:3000/api
ENV NEXT_PUBLIC_SERVER_ORIGIN=http://localhost:3000
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
