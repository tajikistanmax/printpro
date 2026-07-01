import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
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
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    const action = ACTION[method];

    // Только мутации авторизованных пользователей
    if (!action || !req.user) return next.handle();

    // Раздел из пути: /api/orders/123/payments → orders
    const path: string = req.route?.path ?? req.url ?? '';
    const segments = path.split('/').filter(Boolean);
    // Отбрасываем глобальный префикс 'api', берём реальный ресурс
    if (segments[0] === 'api') segments.shift();
    const entity = segments[0] ?? 'unknown';

    return next.handle().pipe(
      tap(() => {
        void this.audit.record({
          companyId: req.user.companyId,
          userId: req.user.sub,
          action,
          entity,
          entityId: req.params?.id,
          data: { method, path: req.originalUrl },
        });
      }),
    );
  }
}
