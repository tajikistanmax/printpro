import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';

// Global — TelegramService доступен для внедрения в любом модуле
@Global()
@Module({
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
