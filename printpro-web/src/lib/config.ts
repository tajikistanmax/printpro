// Настройки фронтенда PrintPro

// Адрес облачного бэкенда (Render). Используется, когда сайт открыт не на
// localhost и переменная окружения не задана.
const CLOUD_API = 'https://printpro-api.onrender.com/api';
const CLOUD_ORIGIN = 'https://printpro-api.onrender.com';

// Порт локального API (NestJS)
const LOCAL_API_PORT = 3000;

// Локальный компьютер или адрес в локальной сети (LAN):
// localhost, 127.x, 10.x, 192.168.x, 172.16–31.x. Для таких адресов фронт
// ходит в API на ТОМ ЖЕ хосте (чтобы работало и по localhost, и по IP с планшета).
function isLocalHost(h: string | null | undefined): boolean {
  if (!h) return false;
  return (
    h === 'localhost' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * Выбираем адрес бэкенда автоматически:
 *  1) если задана переменная окружения — берём её (главнее всего);
 *  2) в браузере: localhost или адрес локальной сети → локальный API на том же
 *     хосте (host:3000), иначе → облачный;
 *  3) на сервере (SSR/сборка): production → облачный, иначе → локальный.
 * Так онлайн-сайт сам ходит в облако, а локальная сеть (в т.ч. по IP) — в API
 * на том же компьютере.
 */
function pick(envVal: string | undefined, cloud: string, suffix: string): string {
  if (envVal) return envVal;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (isLocalHost(h)) return `http://${h}:${LOCAL_API_PORT}${suffix}`;
    return cloud;
  }
  return process.env.NODE_ENV === 'production'
    ? cloud
    : `http://localhost:${LOCAL_API_PORT}${suffix}`;
}

// Адрес нашего бэкенда (NestJS API)
export const API_BASE = pick(process.env.NEXT_PUBLIC_API_BASE, CLOUD_API, '/api');

// Корень бэкенда (для прямых ссылок на файлы /uploads/...)
export const SERVER_ORIGIN = pick(
  process.env.NEXT_PUBLIC_SERVER_ORIGIN,
  CLOUD_ORIGIN,
  '',
);

// Пока нет выбора компании по поддомену — используем нашу тестовую компанию.
// Позже определим автоматически по адресу (dushanbeprint.printpro.app).
export const DEFAULT_COMPANY_ID =
  process.env.NEXT_PUBLIC_COMPANY_ID ??
  '7628001a-5f9c-45ec-8f6f-a80280d409c5';
