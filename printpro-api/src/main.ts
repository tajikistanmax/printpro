import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { initSentry } from './common/sentry';

// Доверенные origin'ы для локальной сети/разработки (localhost и приватные диапазоны).
// В облаке НЕ используется (там строгий CORS_ORIGINS); включается только в dev
// или в коробке через ALLOW_LAN_ORIGINS=1 (кассы ходят к главному ПК по LAN-IP).
function isTrustedDevOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    if (!['http:', 'https:'].includes(protocol)) return false;
    return (
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

// Fail-fast: без критичных переменных окружения не стартуем (понятная ошибка
// при старте вместо загадочных 500 в рантайме у клиента).
function assertRequiredEnv() {
  const required = ['DATABASE_URL'];
  if (process.env.NODE_ENV === 'production') required.push('JWT_SECRET');
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `FATAL: отсутствуют обязательные переменные окружения: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
}

async function bootstrap() {
  assertRequiredEnv();
  // Sentry (если задан SENTRY_DSN) — трекинг ошибок/алерты для прода.
  initSentry();

  const isProduction = process.env.NODE_ENV === 'production';

  // Папка для загруженных файлов. Путь можно переопределить через UPLOADS_DIR
  // (коробка кладёт в userData; облако — на постоянный диск/объектное хранилище),
  // fallback — ./uploads рядом с процессом.
  const uploadsDir = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // За балансировщиком Render/облака: доверяем первому прокси, чтобы req.ip был
  // реальным IP клиента (иначе rate-limit и аудит видят один IP прокси → self-DoS).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Request-id: сквозной идентификатор запроса (принимаем входящий или генерим),
  // кладём в req и в заголовок ответа — по нему логи ошибок связываются с запросом.
  app.use(
    (
      req: { headers: Record<string, unknown>; requestId?: string },
      res: { setHeader: (k: string, v: string) => void },
      next: () => void,
    ) => {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && incoming ? incoming : randomUUID();
      req.requestId = id;
      res.setHeader('x-request-id', id);
      next();
    },
  );

  // Глобальный перехватчик ошибок — структурное логирование 5xx с контекстом.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Security-заголовки. CSP выключаем (API отдаёт JSON/Swagger, не HTML-страницы),
  // CORP=cross-origin — чтобы фронт на другом домене мог грузить /uploads-картинки.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Сжатие ответов (отчёты, списки, пачки синхронизации).
  app.use(compression());

  // Корректное закрытие (SIGTERM на деплое): Nest вызовет onModuleDestroy у
  // PrismaService → соединение с БД закроется, in-flight операции не оборвутся.
  app.enableShutdownHooks();

  // Увеличиваем лимит тела запроса — пачки синхронизации бывают большими
  app.useBodyParser('json', { limit: '50mb' });

  // Глобальная проверка входящих данных по DTO
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // убирать лишние поля
      transform: true, // приводить типы автоматически
    }),
  );

  // Разрешаем запросы с фронтенда (веб/мобилка/сайт)
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowLan = process.env.ALLOW_LAN_ORIGINS === '1';
  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // LAN/dev-доступ: только в разработке или в коробке (ALLOW_LAN_ORIGINS=1),
      // и только для приватных/локальных адресов.
      if ((allowLan || !isProduction) && isTrustedDevOrigin(origin)) {
        return callback(null, true);
      }
      // Неразрешённый origin → чистый отказ CORS (браузер получит ошибку CORS),
      // а не выброшенное исключение, которое превращалось в 500.
      return callback(null, false);
    },
  });

  // Раздача загруженных файлов: /uploads/...
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  // Общий префикс для API: /api/...
  app.setGlobalPrefix('api');

  // OpenAPI/Swagger — документация и песочница API: /api/docs
  if (!isProduction || process.env.SWAGGER_ENABLED === '1') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('PrintPro API')
      .setDescription('REST API платформы PrintPro')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`PrintPro API запущен на порту ${port} (/api)`);
}

// Не роняем процесс молча: логируем необработанные ошибки (иначе крэш без следа).
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('uncaughtException:', err);
});

void bootstrap();
