import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from './audit.service';

// Логирование security-событий, которые НЕ доходят до AuditInterceptor,
// потому что guard'ы срабатывают раньше интерсепторов (P1-9e):
//   - 403 от PermissionsGuard: аутентифицированный пользователь без права
//     (высокий сигнал — попытка доступа к запрещённому);
//   - 401 от JwtAuthGuard, КОГДА был предъявлен Bearer-токен: невалидный,
//     просроченный или отозванный токен (возможен угон/устаревшая сессия).
// 401 без токена («просто не залогинен») НЕ пишем — иначе анонимные сканы
// зафлудили бы журнал. Провалы логина уже пишет интерсептор (`:failed`).
@Catch(UnauthorizedException, ForbiddenException)
export class SecurityAuditFilter implements ExceptionFilter {
  constructor(private readonly audit: AuditService) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: { companyId?: string; sub?: string } }>();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();

    const authHeader = req.headers?.authorization;
    const hadToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
    const shouldLog = status === 403 || (status === 401 && hadToken);

    if (shouldLog) {
      // fire-and-forget: аудит никогда не должен ломать ответ
      void this.audit.record({
        companyId: req.user?.companyId,
        userId: req.user?.sub,
        action: status === 403 ? 'security:forbidden' : 'security:token-rejected',
        entity: 'auth',
        data: {
          method: req.method,
          path: req.originalUrl ?? req.url,
          statusCode: status,
          ip: req.ip,
          userAgent: req.headers?.['user-agent'],
          message: exception.message,
        },
      });
    }

    // Отдаём штатный ответ Nest (тело из самого исключения)
    const body = exception.getResponse();
    res
      .status(status)
      .json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      );
  }
}
