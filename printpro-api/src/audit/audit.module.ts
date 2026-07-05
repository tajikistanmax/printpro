import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { SecurityAuditFilter } from './security-audit.filter';

// Global — чтобы AuditService можно было внедрять где угодно при необходимости
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Логирование guard-level 401/403 (не доходят до интерсептора) — P1-9e
    { provide: APP_FILTER, useClass: SecurityAuditFilter },
  ],
  exports: [AuditService],
})
export class AuditModule {}
