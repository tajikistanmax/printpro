import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

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

async function bootstrap() {
  // Гарантируем папку для загруженных файлов
  mkdirSync(join(process.cwd(), 'uploads'), { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';

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
  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (
        !isProduction &&
        allowedOrigins.length === 0 &&
        isTrustedDevOrigin(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed by CORS'), false);
    },
  });

  // Раздача загруженных файлов: /uploads/...
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
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
  console.log(`PrintPro API запущен: http://localhost:${port}/api`);
}
void bootstrap();
