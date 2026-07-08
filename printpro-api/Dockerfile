# PrintPro API — образ для локального узла (точки)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY scripts ./scripts
# Папка загрузок — монтируется томом в compose
RUN mkdir -p uploads
EXPOSE 3000
# При старте: применяем миграции, идемпотентно заполняем (компания/роли/admin —
# иначе в свежий узел нельзя войти), затем запускаем API. Seed безопасен при
# повторе (findFirst-guard'ы, роли не перезатираются).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/bootstrap/seed.js && node dist/main"]
