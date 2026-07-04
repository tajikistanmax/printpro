import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  // Fail-fast: без секрета JWT токены подписывались бы undefined-ключом.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 16) {
    throw new Error(
      'JWT_SECRET не задан или короче 16 символов — задайте его в .env / окружении',
    );
  }

  // Гарантируем папку для загруженных файлов
  mkdirSync(join(process.cwd(), 'uploads'), { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Увеличиваем лимит тела запроса — пачки синхронизации бывают большими
  app.useBodyParser('json', { limit: '50mb' });

  // Базовые security-заголовки (аналог helmet без новой зависимости)
  app.use((req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Глобальная проверка входящих данных по DTO
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // убирать лишние поля
      transform: true, // приводить типы автоматически
    }),
  );

  // CORS: в проде ограничиваем списком доменов из CORS_ORIGINS
  // (через запятую); без переменной — открыт (локальная разработка/коробка).
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else {
    app.enableCors();
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        'ВНИМАНИЕ: CORS открыт для всех источников — задайте CORS_ORIGINS в проде',
      );
    }
  }

  // Раздача загруженных файлов: /uploads/...
  // Имена файлов — случайные UUID (неугадываемые); nosniff запрещает браузеру
  // интерпретировать содержимое иначе заявленного типа.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    },
  });

  // Общий префикс для API: /api/...
  app.setGlobalPrefix('api');

  // OpenAPI/Swagger — документация и песочница API: /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PrintPro API')
    .setDescription('REST API платформы PrintPro')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`PrintPro API запущен: http://localhost:${port}/api`);
}
bootstrap();
