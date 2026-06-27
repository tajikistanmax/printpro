import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global — чтобы PrismaService был доступен во всех модулях без повторного импорта.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
