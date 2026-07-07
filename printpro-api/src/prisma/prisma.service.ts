import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Единая точка доступа к базе данных PrintPro.
// Любой модуль внедряет PrismaService и работает с таблицами через него.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  // Корректное закрытие соединения при остановке процесса (SIGTERM на деплое/
  // рестарте). Без этого in-flight денежные/складские транзакции обрываются, а
  // пул соединений Postgres утекает. Работает вместе с app.enableShutdownHooks().
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
