import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Global — EmailService доступен для внедрения в любом модуле
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
