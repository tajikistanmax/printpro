import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { captureError } from './sentry';

// Глобальный перехватчик ошибок: 5xx логируются со стеком и контекстом
// (метод/путь/requestId) — раньше необработанные 500 исчезали в эфемерных логах
// без следа. 4xx (ожидаемые бизнес-ошибки) не шумят в логах. Контракт ответа
// сохранён: тело HttpException не меняется (фронт читает body.message), лишь
// добавляется requestId для связи с логом.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof Prisma.PrismaClientKnownRequestError &&
            exception.code === 'P2002'
          ? HttpStatus.CONFLICT
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = req.requestId;

    let body: Record<string, unknown>;
    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      body =
        typeof resp === 'string'
          ? { statusCode: status, message: resp }
          : (resp as Record<string, unknown>);
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      body = {
        statusCode: status,
        message: 'Такая запись уже существует или запрос уже был выполнен',
      };
    } else {
      body = { statusCode: status, message: 'Internal server error' };
    }
    if (requestId) body = { ...body, requestId };

    if (status >= 500) {
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status} [req:${requestId ?? '-'}]`,
        detail,
      );
      // Отправка в Sentry (no-op без SENTRY_DSN) — алерты/контекст по 5xx.
      captureError(exception, {
        requestId,
        method: req.method,
        path: req.originalUrl,
      });
    }

    res.status(status).json(body);
  }
}
