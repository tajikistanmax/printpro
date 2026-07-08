import * as Sentry from '@sentry/node';

// Sentry «под ключ»: активируется вставкой SENTRY_DSN (в render.yaml / env).
// Без DSN — полностью выключен (no-op), никакой отправки данных.
let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Только ошибки, без perf-трейсинга (дёшево, без лишнего трафика).
    tracesSampleRate: 0,
  });
  enabled = true;
}

// Отправить исключение в Sentry с контекстом. No-op, если Sentry не активирован.
export function captureError(
  exception: unknown,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  Sentry.captureException(
    exception,
    context ? { extra: context } : undefined,
  );
}
