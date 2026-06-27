import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  // Гарантируем папку для загруженных файлов
  mkdirSync(join(process.cwd(), 'uploads'), { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
  app.enableCors();

  // Раздача загруженных файлов: /uploads/...
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Общий префикс для API: /api/...
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`PrintPro API запущен: http://localhost:${port}/api`);
}
bootstrap();
