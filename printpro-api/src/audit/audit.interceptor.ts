import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';
import { AuditService } from './audit.service';

// Понятные названия действий по HTTP-методу
const ACTION: Record<string, string> = {
  POST: 'Создание',
  PATCH: 'Изменение',
  PUT: 'Изменение',
  DELETE: 'Удаление',
};

// Логируем только изменяющие запросы
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const method: string = req.method;
    const action = ACTION[method];
    const startedAt = Date.now();
    const headerRequestId = req.headers?.['x-request-id'];
    const requestId =
      typeof headerRequestId === 'string' ? headerRequestId : randomUUID();
    res.setHeader?.('x-request-id', requestId);

    // Логируем любые мутации, включая публичные и sync-эндпоинты
    // (req.user может отсутствовать — тогда companyId/userId будут null).
    // Провалы аутентификации на уровне JwtAuthGuard сюда НЕ доходят:
    // guard'ы в NestJS выполняются раньше интерсепторов. Такие 401/403
    // логируются глобальным SecurityAuditFilter (audit/security-audit.filter.ts). P1-9e
    if (!action) return next.handle();

    // Раздел из пути: /api/orders/123/payments → orders
    const path: string = req.route?.path ?? req.url ?? '';
    const segments = path.split('/').filter(Boolean);
    // Отбрасываем глобальный префикс 'api', берём реальный ресурс
    if (segments[0] === 'api') segments.shift();
    const entity = segments[0] ?? 'unknown';

    // TODO (follow-up, вне этого файла): для денег/склада/RBAC писать audit
    // ВНУТРИ той же транзакции с фиксацией before/after критичных полей
    // (баланс кассы, остаток, роль/права). Здесь мы пишем fire-and-forget
    // после ответа — этого достаточно для requestId/ip/ua/статуса, но не для
    // атомарного before/after бизнес-дельт. См. P1-9 deep-research-report.md.
    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit.record({
            companyId: req.user?.companyId,
            userId: req.user?.sub,
            action,
            entity,
            entityId: req.params?.id,
            data: {
              method,
              path: req.originalUrl,
              statusCode: res.statusCode,
              requestId,
              ip: req.ip,
              userAgent: req.headers?.['user-agent'],
              durationMs: Date.now() - startedAt,
            },
          });
        },
        error: (error: unknown) => {
          const statusCode =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status?: unknown }).status === 'number'
              ? (error as { status: number }).status
              : res.statusCode;
          void this.audit.record({
            companyId: req.user?.companyId,
            userId: req.user?.sub,
            action: `${action}:failed`,
            entity,
            entityId: req.params?.id,
            data: {
              method,
              path: req.originalUrl,
              statusCode,
              requestId,
              ip: req.ip,
              userAgent: req.headers?.['user-agent'],
              durationMs: Date.now() - startedAt,
            },
          });
        },
      }),
    );
  }
}
