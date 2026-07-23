import { Module } from '@nestjs/common';
import { DisplayController } from './display.controller';

// Релей состояния второго экрана покупателя по сети (см. display.controller).
// PrismaService и guards (JwtAuthGuard/PermissionsGuard) доступны глобально
// (@Global в PrismaModule/AuthModule), поэтому здесь достаточно контроллера.
@Module({
  controllers: [DisplayController],
})
export class DisplayModule {}
