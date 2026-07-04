import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

// Лёгкий in-memory rate-limit для эндпоинтов входа: защита от перебора паролей/PIN
// без внешних зависимостей. Хранит счётчик попыток по ключу (IP + companyId) в
// скользящем окне. Для одиночного инстанса (коробка/один облачный процесс) этого
// достаточно; при масштабировании на несколько инстансов нужен общий стор (Redis).
interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000; // окно 1 минута
  private readonly maxAttempts = 10; // не более 10 попыток входа в минуту с ключа

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const ip: string =
      req.ip ||
      req.headers?.['x-forwarded-for'] ||
      req.connection?.remoteAddress ||
      'unknown';
    const companyId: string = req.body?.companyId ?? '-';
    const key = `${ip}:${companyId}`;
    const now = Date.now();

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > this.maxAttempts) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        `Слишком много попыток входа. Повторите через ${retryAfter} с.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  // Периодическая чистка протухших корзин, чтобы Map не рос бесконечно.
  private sweep(now: number) {
    if (this.buckets.size < 512) return;
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(k);
    }
  }
}

// Rate-limit публичных эндпоинтов (/public/*): защита от перебора телефонов и
// UUID (my-orders, receipt, reorder) и спама загрузок. Ключ — IP + путь.
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000; // окно 1 минута
  private readonly maxAttempts = 30; // 30 запросов в минуту с IP на маршрут

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const ip: string =
      req.ip ||
      req.headers?.['x-forwarded-for'] ||
      req.connection?.remoteAddress ||
      'unknown';
    const key = `${ip}:${req.route?.path ?? req.url}`;
    const now = Date.now();

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > this.maxAttempts) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        `Слишком много запросов. Повторите через ${retryAfter} с.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private sweep(now: number) {
    if (this.buckets.size < 2048) return;
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(k);
    }
  }
}
